import { load as loadEnv } from "https://deno.land/std/dotenv/mod.ts";
import { DNS, GoogleAuth } from "https://googleapis.deno.dev/v1/dns:v1.ts";
import * as sdk from "npm:matrix-js-sdk";

const env = await loadEnv();
const dbFile = "./db.json";

const db = JSON.parse(Deno.readTextFileSync(dbFile));

const file = Deno.readTextFileSync("gcloud.json");
const auth = new GoogleAuth().fromJSON(JSON.parse(file));
const dns = new DNS(auth);

const matrix = sdk.createClient({
  baseUrl: env.MATRIX_HOMESERVER,
  accessToken: env.MATRIX_TOKEN,
  userId: env.MATRIX_USER,
});
const domain = env.HANDLE_DOMAIN;
const room = env.MATRIX_ROOM;

function sendMessage(roomId, body, replyTo = null) {
  const msg = {
    body,
    msgtype: "m.text",
    //format: "org.matrix.custom.html",
  };
  if (replyTo) {
    msg["m.relates_to"] = {
      "m.in_reply_to": { event_id: replyTo },
    };
  }
  return matrix.sendEvent(roomId, "m.room.message", msg);
}

function save() {
  return Deno.writeTextFile(dbFile, JSON.stringify(db, null, 2));
}

async function setHandle(name, user, did, replyTo = null) {
  const handle = [name, domain].join(".");
  console.log(`Handle request: user=${user} did=${did} handle=${handle}`);

  let found = null;
  // check if not exists
  if (db.handles[handle]) {
    found = db.handles[handle];
    if (found.user === user) {
      if (found.did === did) {
        return sendMessage(
          room,
          `Tento handle (${handle}) už máte nastavený!`,
          replyTo,
        );
      }
    } else {
      return sendMessage(
        room,
        `Tento handle (${handle}) je už bohužel obsazený.`,
        replyTo,
      );
    }
  }

  const recs = await dns.resourceRecordSetsList(
    env.GCLOUD_DNS_ZONE,
    env.GCLOUD_PROJECT,
  );
  if (recs.rrsets.find((r) => r.name === handle + ".")) {
    return sendMessage(
      room,
      `Bohužel, tento handle (${handle}) si nastavit nemůžete :(`,
      replyTo,
    );
  }

  let prevHandle = Object.keys(db.handles).find((h) =>
    db.handles[h].user === user
  );
  if (prevHandle) {
    const prevDomain = `_atproto.${prevHandle}.`;
    console.log(prevDomain);
    const previous = recs.rrsets.find((r) =>
      r.name === prevDomain && r.type === "TXT"
    );
    if (previous) {
      const dresp = await dns.resourceRecordSetsDelete(
        env.GCLOUD_DNS_ZONE,
        prevDomain,
        env.GCLOUD_PROJECT,
        "TXT",
      );
      console.log(dresp);
    }
    delete db.handles[prevHandle];
  }

  const subdomain = `_atproto.${handle}.`;
  const out = await dns.resourceRecordSetsCreate(
    env.GCLOUD_DNS_ZONE,
    env.GCLOUD_PROJECT,
    {
      name: subdomain,
      type: "TXT",
      rrdatas: [
        `"did=${did}"`,
      ],
    },
  );

  db.handles[handle] = {
    user,
    did,
    createdAt: new Date().toISOString(),
  };
  save();
  return sendMessage(
    room,
    `Hotovo! Váš handle je nastaven (${handle})! Nyní můžete verifikovat změnu handle na Bluesky.`,
    replyTo,
  );
}

matrix.on("Room.timeline", async (event) => {
  const type = event.getType();
  if (type == "m.room.message" && event.getRoomId() === room) {
    if (db.answered.includes(event.getId())) {
      return null;
    }
    const { body } = event.getContent();

    if (body.startsWith("!handle")) {
      const handleMatch = body.match(
        /^!handle ([a-zA-Z0-9-\.]+) (did=|)(did:plc:[a-z0-9]+)$/,
      );
      if (handleMatch) {
        await setHandle(
          handleMatch[1],
          event.getSender(),
          handleMatch[3],
          event.getId(),
        );
      } else {
        await sendMessage(
          room,
          'Nesprávný příkaz! Zadávejte ve formě: "!handle jméno did", například: "!handle tree did:plc:524tuhdhh3m7li5gycdn6boe"',
          event.getId(),
        );
      }
      db.answered.push(event.getId());
      save();
    }
  }
});

//const zones = await dns.managedZonesList(env.GCLOUD_DNS_ZONE);
//console.log(zones)
//const items = await dns.resourceRecordSetsList(env.GCLOUD_DNS_ZONE, env.GCLOUD_PROJECT)
//console.log(items)
matrix.startClient();
