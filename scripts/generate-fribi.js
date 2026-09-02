import { readFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const templatePath = path.join(root, "docs/welcome-fribi/template.html");
const pdfPath = path.join(root, "docs/welcome-fribi/checklist-7min.pdf");
const previewPath = path.join(root, "docs/welcome-fribi/checklist-7min.preview.png");

const LAUNCH_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"];
const MIN_PDF_BYTES = 15000;
const MIN_PREVIEW_BYTES = 10000;

async function launchBrowser() {
  try {
    return await puppeteer.launch({ headless: true, args: LAUNCH_ARGS });
  } catch (e) {
    console.warn(`bundled launch failed: ${e.message}`);
    const candidates = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      "/usr/bin/google-chrome-stable",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
      "/usr/bin/chromium",
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ].filter(Boolean);
    let lastErr = e;
    for (const exe of candidates) {
      try {
        return await puppeteer.launch({ headless: true, args: LAUNCH_ARGS, executablePath: exe });
      } catch (err) {
        lastErr = err;
        console.warn(`launch with ${exe} failed: ${err.message}`);
      }
    }
    throw lastErr;
  }
}

async function main() {
  const html = await readFile(templatePath, "utf-8");
  await mkdir(path.dirname(pdfPath), { recursive: true });
  await mkdir(path.dirname(previewPath), { recursive: true });

  let browser;
  try {
    browser = await launchBrowser();

    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: "load", timeout: 15000 });
    {
      const h = await page.evaluateHandle(() => document.fonts.ready);
      await h.jsonValue();
      await h.dispose();
    }

    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });
    console.log(`PDF: ${pdfPath}`);

    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });
    await page.screenshot({
      path: previewPath,
      fullPage: false,
      clip: { x: 0, y: 0, width: 1080, height: 1920 },
    });
    console.log(`Preview: ${previewPath}`);
  } finally {
    if (browser) await browser.close();
  }

  const pdfStat = await stat(pdfPath);
  const prevStat = await stat(previewPath).catch(() => null);
  console.log(`PDF size: ${pdfStat.size} bytes`);
  if (prevStat) console.log(`Preview size: ${prevStat.size} bytes`);
  if (pdfStat.size < MIN_PDF_BYTES) throw new Error(`PDF too small (${pdfStat.size} < ${MIN_PDF_BYTES}), likely broken`);
  if (!prevStat) throw new Error(`Preview missing at ${previewPath}`);
  if (prevStat.size < MIN_PREVIEW_BYTES) throw new Error(`Preview too small (${prevStat.size} < ${MIN_PREVIEW_BYTES})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
