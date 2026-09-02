import {
  CheckReport,
  HopCheck,
  HopRecord,
  LineRange,
  RepositoryProvenance,
  ResumeStatus,
  StructuralSignature,
  TrajectoryState,
} from "./types.js";
import {
  extractRange,
  normalizeRelativePath,
  normalizedLines,
  normalizeSpan,
  readFileText,
  repositoryProvenance,
  resolveRepositoryFile,
  sha256,
  structuralSignature,
} from "./paths.js";

interface FileSnapshot {
  bytes: Buffer;
  lines: string[];
  hash: string;
}

function snapshot(root: string, storedPath: string): FileSnapshot {
  const file = readFileText(root, storedPath);
  return { bytes: file.bytes, lines: normalizedLines(file.text), hash: sha256(file.bytes) };
}

function sameSignature(left: StructuralSignature, right: StructuralSignature): boolean {
  return left.firstHash === right.firstHash && left.lastHash === right.lastHash;
}

function windows(totalLines: number, spanLineCount: number, original: LineRange, limit: number): number[] {
  const total = totalLines - spanLineCount + 1;
  if (total <= 0 || limit <= 0) return [];
  const count = Math.min(total, limit);
  const starts: number[] = [];
  const add = (value: number): void => {
    if (value >= 1 && value <= total && !starts.includes(value)) starts.push(value);
  };
  add(original.start);
  if (count === 1) return starts;
  for (let index = 0; index < count; index += 1) {
    add(1 + Math.floor((index * (total - 1)) / (count - 1)));
  }
  return starts.slice(0, limit);
}

function rangeFits(lines: readonly string[], range: LineRange): boolean {
  return range.start >= 1 && range.end >= range.start && range.end <= lines.length;
}

function staleCheck(hop: HopRecord, reason: string, currentFileSha256?: string): HopCheck {
  return {
    index: hop.index,
    path: hop.path,
    status: "STALE",
    originalRange: hop.range,
    reason,
    ...(currentFileSha256 ? { currentFileSha256 } : {}),
  };
}

function verifyHop(root: string, hop: HopRecord, maxWindows: number): HopCheck {
  let file: FileSnapshot;
  try {
    resolveRepositoryFile(root, hop.path);
    file = snapshot(root, hop.path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "file unavailable";
    return staleCheck(hop, reason);
  }

  if (file.hash === hop.fileSha256) {
    return { index: hop.index, path: hop.path, status: "FRESH", originalRange: hop.range, resolvedRange: hop.range, currentFileSha256: file.hash };
  }

  if (rangeFits(file.lines, hop.range)) {
    const current = normalizeSpan(extractRange(file.lines, hop.range));
    if (sha256(Buffer.from(current, "utf8")) === hop.normalizedSpanHash) {
      return { index: hop.index, path: hop.path, status: "FRESH", originalRange: hop.range, resolvedRange: hop.range, currentFileSha256: file.hash };
    }
  }

  const lineCount = hop.spanLineCount;
  const starts = windows(file.lines.length, lineCount, hop.range, maxWindows);
  const exact: LineRange[] = [];
  const signatureHits: LineRange[] = [];
  const scanLimited = file.lines.length - lineCount + 1 > starts.length;
  for (const start of starts) {
    const range = { start, end: start + lineCount - 1 };
    const normalized = normalizeSpan(extractRange(file.lines, range));
    const candidateHash = sha256(Buffer.from(normalized, "utf8"));
    if (candidateHash === hop.normalizedSpanHash) exact.push(range);
    if (sameSignature(structuralSignature(normalized), hop.structuralSignature)) signatureHits.push(range);
  }
  if (exact.length === 1) {
    return { index: hop.index, path: hop.path, status: "MOVED", originalRange: hop.range, resolvedRange: exact[0], currentFileSha256: file.hash };
  }
  if (exact.length > 1) return staleCheck(hop, "ambiguous exact span relocation", file.hash);
  if (signatureHits.length > 0) return staleCheck(hop, "signature-only candidate; exact span is not trustworthy", file.hash);
  if (scanLimited) return staleCheck(hop, `relocation scan limited to ${maxWindows} windows`, file.hash);
  return staleCheck(hop, "recorded span was deleted or changed", file.hash);
}

function provenanceChanged(recorded: RepositoryProvenance, current: RepositoryProvenance): boolean {
  return recorded.branch !== current.branch || recorded.head !== current.head;
}

export function checkTrajectory(root: string, state: TrajectoryState, maxWindows: number): CheckReport {
  const current = repositoryProvenance(root);
  const changed = provenanceChanged(state.repository, current);
  const hops: HopCheck[] = state.hops.map((hop) => verifyHop(root, hop, maxWindows));
  const firstStale = hops.findIndex((hop) => hop.status === "STALE");
  const quarantined = state.status === "STALE";
  const verifiedThrough = quarantined ? -1 : firstStale === -1 ? hops.length - 1 : firstStale - 1;
  const staleReasons = [
    ...state.staleReasons,
    ...hops.filter((hop) => hop.reason).map((hop) => `${hop.path}: ${hop.reason}`),
  ];
  if (changed) staleReasons.unshift(`repository provenance changed from ${state.repository.branch}@${state.repository.head.slice(0, 12)} to ${current.branch}@${current.head.slice(0, 12)}`);
  let status: ResumeStatus;
  if (firstStale !== -1 || quarantined) status = "STALE";
  else if (changed) status = "CROSS_BRANCH";
  else status = "STAGED";
  return {
    waymark: 1,
    kind: "check",
    status,
    trajectoryId: state.id,
    provenanceChanged: changed,
    recordedRepository: state.repository,
    currentRepository: current,
    verifiedThrough,
    totalSteps: hops.length,
    hops,
    staleReasons,
  };
}

export function validateStoredPath(root: string, storedPath: string): string {
  return normalizeRelativePath(resolveRepositoryFile(root, storedPath).lexical === storedPath ? storedPath : storedPath);
}
