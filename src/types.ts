export type AdapterProfile = "recording" | "capn-cli" | "none";
export type StoredHopStatus = "FRESH" | "MOVED";
export type VerificationStatus = "FRESH" | "MOVED" | "STALE";
export type ResumeStatus = "STAGED" | "CROSS_BRANCH" | "STALE" | "NONE";

export interface LineRange {
  start: number;
  end: number;
}

export interface StructuralSignature {
  firstHash: string;
  lastHash: string;
  firstTokensPrefix: string[];
  lastTokensPrefix: string[];
}

export interface RepositoryProvenance {
  branch: string;
  head: string;
}

export interface HopRecord {
  index: number;
  path: string;
  label: string;
  inference: string;
  range: LineRange;
  fileSha256: string;
  normalizedSpanHash: string;
  normalizedSpanLen: number;
  spanLineCount: number;
  structuralSignature: StructuralSignature;
}

export interface CommonEvent {
  waymark: 1;
  type: string;
  trajectoryId: string;
  sequence: number;
  at: string;
}

export interface TrajectoryStartedEvent extends CommonEvent {
  type: "trajectory.started";
  profile: AdapterProfile;
  question: string;
  repository: RepositoryProvenance;
}

export interface HopAddedEvent extends CommonEvent {
  type: "hop.added";
  hop: HopRecord;
}

export interface TrajectoryStaleEvent extends CommonEvent {
  type: "trajectory.stale";
  reason: string;
}

export interface TrajectoryCommittedEvent extends CommonEvent {
  type: "trajectory.committed";
  answer: string;
}

export interface PublicationPendingEvent extends CommonEvent {
  type: "publication.pending";
  adapter: AdapterProfile;
}

export interface PublicationSucceededEvent extends CommonEvent {
  type: "publication.succeeded";
  adapter: AdapterProfile;
  adapterOutput: string;
}

export interface PublicationFailedEvent extends CommonEvent {
  type: "publication.failed";
  adapter: AdapterProfile;
  reason: string;
}

export interface TrajectoryAbandonedEvent extends CommonEvent {
  type: "trajectory.abandoned";
  reason: string;
}

export type WaymarkEvent =
  | TrajectoryStartedEvent
  | HopAddedEvent
  | TrajectoryStaleEvent
  | TrajectoryCommittedEvent
  | PublicationPendingEvent
  | PublicationSucceededEvent
  | PublicationFailedEvent
  | TrajectoryAbandonedEvent;

export interface TrajectoryState {
  id: string;
  profile: AdapterProfile;
  question: string;
  repository: RepositoryProvenance;
  hops: HopRecord[];
  status: "STAGED" | "STALE" | "COMMITTED" | "ABANDONED";
  answer?: string;
  staleReasons: string[];
  events: WaymarkEvent[];
}

export interface ActivePointerNone {
  waymark: 1;
  status: "NONE";
  updatedAt: string;
}

export interface ActivePointerActive {
  waymark: 1;
  status: "STAGED" | "STALE";
  trajectoryId: string;
  journal: string;
  updatedAt: string;
}

export type ActivePointer = ActivePointerNone | ActivePointerActive;

export interface WaymarkConfig {
  waymark: 1;
  profile: AdapterProfile;
  capnExecutable: string;
  maxRelocationWindows: number;
}

export interface HopCheck {
  index: number;
  path: string;
  status: VerificationStatus;
  originalRange: LineRange;
  resolvedRange?: LineRange;
  reason?: string;
  currentFileSha256?: string;
}

export interface CheckReport {
  waymark: 1;
  kind: "check";
  status: ResumeStatus;
  trajectoryId: string | null;
  provenanceChanged: boolean;
  recordedRepository: RepositoryProvenance | null;
  currentRepository: RepositoryProvenance | null;
  verifiedThrough: number;
  totalSteps: number;
  hops: HopCheck[];
  staleReasons: string[];
}

export interface ResumeHop {
  index: number;
  path: string;
  label: string;
  inference: string;
  status: StoredHopStatus;
}

export interface ResumeInput {
  trajectoryId: string;
  status: ResumeStatus;
  question: string;
  verifiedThrough: number;
  totalSteps: number;
  hops: readonly ResumeHop[];
  nextAction: string;
  staleReasons: readonly string[];
}

export interface ResumePacket {
  waymark: 1;
  kind: "compact-resume";
  status: ResumeStatus;
  trajectoryId: string;
  question: string;
  verifiedThrough: number;
  totalSteps: number;
  hops: ResumeHop[];
  nextAction: string;
  staleReasons: string[];
  omittedBefore: number;
  truncated: boolean;
}

export interface PublicationResult {
  published: boolean;
  adapter: AdapterProfile;
  output: string;
  error?: string;
}

export class WaymarkError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.name = "WaymarkError";
    this.code = code;
    this.exitCode = exitCode;
  }
}
