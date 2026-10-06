import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputDir = path.resolve(__dirname, "../.output/public");

if (!fs.existsSync(outputDir)) {
  console.error(`Output directory does not exist: ${outputDir}`);
  process.exit(1);
}

// 1. Ensure .nojekyll exists so GitHub Pages serves all assets
const noJekyllPath = path.join(outputDir, ".nojekyll");
fs.writeFileSync(noJekyllPath, "", "utf8");
console.log(`Created ${noJekyllPath}`);

// 2. Ensure 404.html exists as a fallback for client-side routing on GitHub Pages
const indexPath = path.join(outputDir, "index.html");
const notFoundPath = path.join(outputDir, "404.html");

if (fs.existsSync(indexPath)) {
  fs.copyFileSync(indexPath, notFoundPath);
  console.log(`Created ${notFoundPath} from ${indexPath}`);
} else {
  console.warn(`Warning: index.html not found at ${indexPath}`);
}

console.log("GitHub Pages output preparation complete.");

