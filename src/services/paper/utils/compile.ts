import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs";
import logger from "../../../utils/logger";

export async function compileLatexToPDF(
  workDir: string,
  mainTexFile: string = "main.tex",
): Promise<{ success: boolean; pdfPath?: string; logs: string }> {
  const latexDir = path.join(workDir, "latex");
  const mainTexPath = path.join(latexDir, mainTexFile);

  if (!fs.existsSync(mainTexPath)) {
    throw new Error(`LaTeX main file not found: ${mainTexPath}`);
  }

  logger.info({ workDir }, "compiling_latex");

  try {
    const result = await tryLatexmk(latexDir, mainTexFile);
    if (result.success) return result;
  } catch (error) {
    logger.warn("latexmk_failed_trying_manual");
  }

  return await tryManualCompilation(latexDir, mainTexFile);
}

async function tryLatexmk(
  latexDir: string,
  mainTexFile: string,
): Promise<{ success: boolean; pdfPath?: string; logs: string }> {
  return new Promise((resolve) => {
    const args = [
      "-xelatex", // Use XeLaTeX for native Unicode support
      "-bibtex",
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      mainTexFile,
    ];

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
        logger.info("latexmk_succeeded");
        resolve({ success: true, pdfPath, logs });
      } else {
        resolve({ success: false, logs });
      }
    });

    proc.on("error", (error) => {
      resolve({ success: false, logs: error.message });
    });
  });
}

async function tryManualCompilation(
  latexDir: string,
  mainTexFile: string,
): Promise<{ success: boolean; pdfPath?: string; logs: string }> {
  const baseFilename = mainTexFile.replace(".tex", "");
  let allLogs = "";

  logger.info("running_manual_compilation");

  // Using XeLaTeX for native Unicode support (handles β, ′, accented chars, etc.)
  const pass1 = await runCommand("xelatex", [
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-file-line-error",
    mainTexFile,
  ], latexDir);
  allLogs += "=== XELATEX PASS 1 ===\n" + pass1.logs + "\n\n";

  if (!pass1.success) return { success: false, logs: allLogs };

  const auxPath = path.join(latexDir, `${baseFilename}.aux`);
  if (fs.existsSync(auxPath)) {
    const bibtexResult = await runCommand("bibtex", [baseFilename], latexDir);
    allLogs += "=== BIBTEX ===\n" + bibtexResult.logs + "\n\n";
  }

  const pass2 = await runCommand("xelatex", [
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-file-line-error",
    mainTexFile,
  ], latexDir);
  allLogs += "=== XELATEX PASS 2 ===\n" + pass2.logs + "\n\n";

  if (!pass2.success) return { success: false, logs: allLogs };

  const pass3 = await runCommand("xelatex", [
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-file-line-error",
    mainTexFile,
  ], latexDir);
  allLogs += "=== XELATEX PASS 3 ===\n" + pass3.logs + "\n\n";

  const pdfPath = path.join(latexDir, `${baseFilename}.pdf`);

  if (pass3.success && fs.existsSync(pdfPath)) {
    logger.info("manual_compilation_succeeded");
    return { success: true, pdfPath, logs: allLogs };
  }

  return { success: false, logs: allLogs };
}

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

export function extractLastLines(logs: string, lines: number = 200): string {
  const allLines = logs.split("\n");
  return allLines.slice(-lines).join("\n");
}

export function checkForUndefinedCitations(logs: string): string[] {
  const undefinedCitations: string[] = [];
  const citationWarningRegex = /(?:LaTeX Warning: Citation [`']([^'`]+)['`] undefined|Warning--I didn't find a database entry for "([^"]+)")/g;

  let match;
  while ((match = citationWarningRegex.exec(logs)) !== null) {
    const key = match[1] || match[2];
    if (key) undefinedCitations.push(key);
  }

  return Array.from(new Set(undefinedCitations));
}
