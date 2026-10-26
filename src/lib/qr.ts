import qrcode from "qrcode-generator";

/**
 * QR codes for the share links.
 *
 * The code itself comes from `qrcode-generator`, a dependency-free MIT
 * library; this module only turns it into a grid of modules that React can
 * render as SVG. Rendering the modules ourselves — rather than injecting the
 * library's own SVG markup — keeps the code in the page's own colours, and
 * keeps a string of markup out of the DOM.
 */

/**
 * Error correction level "M": about 15% of the code can be damaged and still
 * scan. A code shown on a phone screen, in daylight, or held at an angle
 * needs more headroom than "L" gives, and "H" would make the code so dense
 * that a small screen cannot resolve it.
 */
const ERROR_CORRECTION = "M";

/**
 * The QR code of a string, as a square grid: `modules[row][col]` is true
 * where the module is dark.
 *
 * The data is encoded in byte mode, so it has to be ASCII. A URL is: the
 * plan id is a number and the path is percent-encoded.
 */
export function qrMatrix(data: string): boolean[][] {
  const code = qrcode(0, ERROR_CORRECTION);
  code.addData(data);
  code.make();
  const count = code.getModuleCount();
  const modules: boolean[][] = [];
  for (let row = 0; row < count; row += 1) {
    const line: boolean[] = [];
    for (let col = 0; col < count; col += 1) {
      line.push(code.isDark(row, col));
    }
    modules.push(line);
  }
  return modules;
}

/**
 * The dark modules of a code as one SVG path.
 *
 * One path instead of a rectangle per module: a version 3 code is 29×29
 * modules, and a path of 400 squares is one DOM node instead of 400.
 */
export function qrPath(modules: boolean[][]): string {
  const parts: string[] = [];
  for (let row = 0; row < modules.length; row += 1) {
    const line = modules[row] ?? [];
    for (let col = 0; col < line.length; col += 1) {
      if (line[col]) parts.push(`M${col} ${row}h1v1h-1z`);
    }
  }
  return parts.join("");
}
