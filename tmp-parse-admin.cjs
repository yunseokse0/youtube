const fs = require("fs");
for (const p of ["C:/youtube/public/overlay.html", "C:/youtube/public/admin.html"]) {
  const s = fs.readFileSync(p, "utf8");
  const re = /<script>([\s\S]*?)<\/script>/g;
  let i = 0;
  let m;
  while ((m = re.exec(s))) {
    try {
      new Function(m[1]);
      console.log(p, i, "ok", m[1].length);
    } catch (e) {
      console.log(p, i, e.message);
      process.exitCode = 1;
    }
    i += 1;
  }
}
