/**
 * Pandoc Markdown → LaTeX conversion
 *
 * Shells out to pandoc to produce syntactically valid LaTeX from Markdown.
 */

import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import logger from "../../../utils/logger";

/**
 * Convert a Markdown file to LaTeX using Pandoc
 *
 * @param mdPath - Path to input .md file
 * @param bibPath - Path to .bib bibliography file
 * @param outputDir - Directory to write the .tex file
 * @returns Path to the generated .tex file
 */
export async function pandocConvert(
  mdPath: string,
  bibPath: string,
  outputDir: string,
): Promise<string> {
  await checkPandocInstalled();

  const texPath = path.join(outputDir, "main.tex");

  const args = [
    mdPath,
    "-o",
    texPath,
    "--standalone",
    "--natbib",
    `--bibliography=${bibPath}`,
    // Use XeLaTeX as the PDF engine reference (affects template vars)
    "--pdf-engine=xelatex",
  ];

  logger.info({ args }, "running_pandoc");

  const { success, stderr } = await runPandoc(args, path.dirname(mdPath));

  if (!success) {
    logger.error({ stderr }, "pandoc_conversion_failed");
    throw new Error(`Pandoc conversion failed:\n${stderr}`);
  }

  if (!fs.existsSync(texPath)) {
    throw new Error(`Pandoc did not produce output file: ${texPath}`);
  }

  // Post-process: ensure XeLaTeX compatibility
  let texContent = fs.readFileSync(texPath, "utf-8");
  texContent = patchForXelatex(texContent);
  fs.writeFileSync(texPath, texContent, "utf-8");

  logger.info({ texPath }, "pandoc_conversion_complete");
  return texPath;
}

/**
 * Patch Pandoc LaTeX output for XeLaTeX compatibility
 * Pandoc may produce pdflatex-specific commands that need adjustment
 */
function patchForXelatex(tex: string): string {
  let result = tex;

  // For older Pandoc: replace inputenc with fontspec (XeLaTeX native Unicode)
  result = result.replace(
    /\\usepackage\[utf8\]\{inputenc\}/g,
    "\\usepackage{fontspec}",
  );

  // Remove \usepackage[T1]{fontenc} — XeLaTeX uses fontspec instead
  result = result.replace(/\\usepackage\[T1\]\{fontenc\}\n?/g, "");

  // Remove lmodern — Latin Modern lacks glyphs for Unicode Greek (κ,γ,η,etc.)
  // and math symbols (≈,≤,≥,etc.)
  result = result.replace(/\\usepackage\{lmodern\}\n?/g, "");

  // Ensure Linux Libertine is set as main font (2000+ glyphs, full Unicode)
  // and graphicspath is set — inject both before \begin{document}
  const docBegin = result.indexOf("\\begin{document}");
  if (docBegin !== -1) {
    const preambleAdditions: string[] = [];

    if (!result.includes("\\setmainfont")) {
      // Use \IfFontExistsTF to handle both OTF ("Linux Libertine O" from Debian)
      // and TTF ("Linux Libertine" from Homebrew/other) installations
      preambleAdditions.push(
        "\\IfFontExistsTF{Linux Libertine O}" +
          "{\\setmainfont{Linux Libertine O}\\setsansfont{Linux Biolinum O}}" +
          "{\\setmainfont{Linux Libertine}}",
      );
    }

    if (!result.includes("\\graphicspath")) {
      preambleAdditions.push("\\graphicspath{{figures/}}");
    }

    if (preambleAdditions.length > 0) {
      result =
        result.slice(0, docBegin) +
        preambleAdditions.join("\n") +
        "\n\n" +
        result.slice(docBegin);
    }
  }

  logger.info(
    { hasSetmainfont: result.includes("\\setmainfont") },
    "patchForXelatex_complete",
  );

  return result;
}

/**
 * Check that pandoc is installed and accessible
 */
export async function checkPandocInstalled(): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pandoc", ["--version"], {
      env: {
        ...process.env,
        PATH: `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH}`,
      },
    });

    let stdout = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const versionLine = stdout.split("\n")[0] || "unknown";
        logger.info({ version: versionLine }, "pandoc_available");
        resolve();
      } else {
        reject(
          new Error(
            "Pandoc is not installed or not in PATH. Install with: apt-get install pandoc (Linux) or brew install pandoc (macOS)",
          ),
        );
      }
    });

    proc.on("error", () => {
      reject(
        new Error(
          "Pandoc is not installed or not in PATH. Install with: apt-get install pandoc (Linux) or brew install pandoc (macOS)",
        ),
      );
    });
  });
}

const PANDOC_TIMEOUT_MS = 60_000; // 60 seconds

/**
 * Run pandoc with given arguments
 */
function runPandoc(
  args: string[],
  cwd: string,
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn("pandoc", args, {
      cwd,
      env: {
        ...process.env,
        PATH: `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH}`,
      },
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill("SIGKILL");
    }, PANDOC_TIMEOUT_MS);

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (killed) {
        resolve({ success: false, stdout, stderr: `Pandoc timed out after ${PANDOC_TIMEOUT_MS / 1000}s\n${stderr}` });
      } else {
        resolve({ success: code === 0, stdout, stderr });
      }
    });

    proc.on("error", (error) => {
      clearTimeout(timer);
      resolve({ success: false, stdout: "", stderr: error.message });
    });
  });
}
