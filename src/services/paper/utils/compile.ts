/**
 * LaTeX to PDF compilation utilities
 */

import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import logger from "../../../utils/logger";

/**
 * Compile LaTeX to PDF using latexmk (preferred) or pdflatex+bibtex fallback
 */
export async function compileLatexToPDF(
  workDir: string,
  mainTexFile: string = "main.tex",
): Promise<{ success: boolean; pdfPath?: string; logs: string }> {
  const latexDir = path.join(workDir, "latex");
  const mainTexPath = path.join(latexDir, mainTexFile);

  // Check if main.tex exists
  if (!fs.existsSync(mainTexPath)) {
    throw new Error(`LaTeX main file not found: ${mainTexPath}`);
  }

  logger.info({ workDir, mainTexFile }, "compiling_latex_to_pdf");

  // Try latexmk first (best option - handles multiple passes automatically)
  try {
    const result = await tryLatexmk(latexDir, mainTexFile);
    if (result.success) {
      return result;
    }
  } catch (error) {
    logger.warn({ error }, "latexmk_compilation_failed_trying_fallback");
  }

  // Fallback to manual pdflatex + bibtex
  return await tryManualCompilation(latexDir, mainTexFile);
}

/**
 * Try compiling with latexmk (preferred method)
 */
async function tryLatexmk(
  latexDir: string,
  mainTexFile: string,
): Promise<{ success: boolean; pdfPath?: string; logs: string }> {
  return new Promise((resolve) => {
    const args = [
      "-pdf",
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      mainTexFile,
    ];

    logger.info({ cmd: "latexmk", args }, "running_latexmk");

    const proc = spawn("latexmk", args, {
      cwd: latexDir,
      env: {
        ...process.env,
        PATH: `/Library/TeX/texbin:${process.env.PATH}`,
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      const logs = stdout + "\n" + stderr;
      const pdfPath = path.join(latexDir, mainTexFile.replace(".tex", ".pdf"));

      if (code === 0 && fs.existsSync(pdfPath)) {
        logger.info({ pdfPath }, "latexmk_compilation_succeeded");
        resolve({ success: true, pdfPath, logs });
      } else {
        logger.warn({ code, latexDir }, "latexmk_compilation_failed");
        resolve({ success: false, logs });
      }
    });

    proc.on("error", (error) => {
      logger.error({ error }, "latexmk_process_error");
      resolve({ success: false, logs: error.message });
    });
  });
}

/**
 * Fallback: Manual compilation with pdflatex + bibtex
 * Runs: pdflatex -> bibtex -> pdflatex -> pdflatex
 */
async function tryManualCompilation(
  latexDir: string,
  mainTexFile: string,
): Promise<{ success: boolean; pdfPath?: string; logs: string }> {
  const baseFilename = mainTexFile.replace(".tex", "");
  let allLogs = "";

  logger.info({ latexDir, mainTexFile }, "running_manual_latex_compilation");

  // Step 1: pdflatex (first pass)
  const pass1 = await runCommand("pdflatex", [
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-file-line-error",
    mainTexFile,
  ], latexDir);
  allLogs += "=== PDFLATEX PASS 1 ===\n" + pass1.logs + "\n\n";

  if (!pass1.success) {
    return { success: false, logs: allLogs };
  }

  // Step 2: bibtex (if .aux file exists)
  const auxPath = path.join(latexDir, `${baseFilename}.aux`);
  if (fs.existsSync(auxPath)) {
    const bibtexResult = await runCommand("bibtex", [baseFilename], latexDir);
    allLogs += "=== BIBTEX ===\n" + bibtexResult.logs + "\n\n";
    // Don't fail on bibtex errors - just log them
  }

  // Step 3: pdflatex (second pass - resolve references)
  const pass2 = await runCommand("pdflatex", [
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-file-line-error",
    mainTexFile,
  ], latexDir);
  allLogs += "=== PDFLATEX PASS 2 ===\n" + pass2.logs + "\n\n";

  if (!pass2.success) {
    return { success: false, logs: allLogs };
  }

  // Step 4: pdflatex (third pass - finalize)
  const pass3 = await runCommand("pdflatex", [
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-file-line-error",
    mainTexFile,
  ], latexDir);
  allLogs += "=== PDFLATEX PASS 3 ===\n" + pass3.logs + "\n\n";

  const pdfPath = path.join(latexDir, `${baseFilename}.pdf`);

  if (pass3.success && fs.existsSync(pdfPath)) {
    logger.info({ pdfPath }, "manual_compilation_succeeded");
    return { success: true, pdfPath, logs: allLogs };
  } else {
    logger.error({ latexDir }, "manual_compilation_failed");
    return { success: false, logs: allLogs };
  }
}

/**
 * Run a shell command and capture output
 */
async function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ success: boolean; logs: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        PATH: `/Library/TeX/texbin:${process.env.PATH}`,
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      const logs = stdout + "\n" + stderr;
      resolve({ success: code === 0, logs });
    });

    proc.on("error", (error) => {
      resolve({ success: false, logs: error.message });
    });
  });
}

/**
 * Extract last N lines from compilation logs (for error reporting)
 */
export function extractLastLines(logs: string, lines: number = 200): string {
  const allLines = logs.split("\n");
  return allLines.slice(-lines).join("\n");
}
