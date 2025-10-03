import { Command } from "commander";
import { z } from "zod";

import type { StatusMode } from "./concurrency";

export function createCliCommand(name: string, description?: string): Command {
  const command = new Command(name);
  if (description) {
    command.description(description);
  }
  command.showHelpAfterError("(use --help for usage information)");
  command.showSuggestionAfterError();
  return command;
}

export function createIntegerParser({
  name,
  min,
  max,
}: {
  name: string;
  min?: number;
  max?: number;
}): (raw: string) => number {
  return (raw) => {
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || Number.isNaN(value)) {
      throw new Error(`Invalid ${name} value: ${raw}`);
    }
    if (min !== undefined && value < min) {
      throw new Error(`${name} must be >= ${min}`);
    }
    if (max !== undefined && value > max) {
      throw new Error(`${name} must be <= ${max}`);
    }
    return value;
  };
}

const StatusModeSchema = z.enum(["interactive", "plain", "off"]);

export function parseStatusModeOption(value: string): StatusMode {
  return StatusModeSchema.parse(value.toLowerCase()) as StatusMode;
}

export function parseBooleanOption(value: string): boolean {
  const normalised = value.trim().toLowerCase();
  if (normalised === "true" || normalised === "1" || normalised === "yes") {
    return true;
  }
  if (normalised === "false" || normalised === "0" || normalised === "no") {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
}

export function splitCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
