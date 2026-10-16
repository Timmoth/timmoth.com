new p5((s) => {
  let t = 0; // time offset

  s.setup = () => {
    const canvas = s.createCanvas(window.innerWidth, window.innerHeight);
    canvas.position(0, 0);
    canvas.style("position", "fixed");
    canvas.style("z-index", "-1"); // behind content
    s.noStroke();
    s.colorMode(s.HSB, 360, 100, 100, 255);
    s.frameRate(30);
  };

  s.draw = () => {
    s.clear(); // transparent background each frame

    let gridSize = 20; // resolution of blobs
    t += 0.016; // animation speed (doubled to compensate for halved framerate)

    for (let x = 0; x < s.width; x += gridSize) {
      for (let y = 0; y < s.height; y += gridSize) {
        let n = s.noise(x * 0.002, y * 0.002, t);
        // Integer hue keeps p5's color cache bounded — float hues
        // accumulate millions of unique cache entries and eventually
        // crash with "Too many properties to enumerate".
        let hue = (200 + 160 * n) | 0;
        let alpha = 25; // subtle transparency

        s.fill(hue % 360, 80, 100, alpha);
        s.rect(x, y, gridSize, gridSize);
      }
    }
  };

  s.windowResized = () => s.resizeCanvas(window.innerWidth, window.innerHeight);
});

function log(msg) {
  console.log("%c" + msg, "color:#7dd3fc; font-family:monospace;");
}
log("It's open source - just check out the repo ;)");
log("https://github.com/Timmoth/timmoth.com")
