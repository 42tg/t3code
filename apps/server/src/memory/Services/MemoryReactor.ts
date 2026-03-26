/**
 * MemoryReactor - Autonomous memory extraction reactor service interface.
 *
 * Reacts to turn completion events and automatically generates thread
 * summaries and triggers periodic project/daily extraction.
 *
 * @module MemoryReactor
 */
import { ServiceMap } from "effect";
import type { Effect, Scope } from "effect";

export interface MemoryReactorShape {
  /**
   * Start the memory reactor.
   *
   * Subscribes to `turn.processing.quiesced` receipts and auto-generates
   * thread summaries. Periodically triggers project + daily extraction.
   *
   * Must be run in a scope for fiber cleanup on shutdown.
   */
  readonly start: Effect.Effect<void, never, Scope.Scope>;
}

export class MemoryReactor extends ServiceMap.Service<MemoryReactor, MemoryReactorShape>()(
  "t3/memory/Services/MemoryReactor",
) {}
