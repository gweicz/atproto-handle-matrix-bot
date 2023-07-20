module.exports = {
  apps : [{
    name   : "atproto-handle-bot",
    interpreter: "deno",
    interpreterArgs: "run -A",
    script : "bot.js"
  }]
}