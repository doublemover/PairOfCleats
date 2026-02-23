export const STAGE1_POSTINGS_QUEUE_TELEMETRY_CHANNEL = 'stage1.postings-queue';

/**
 * Build stage1 postings queue telemetry helpers.
 *
 * @param {{runtime?:object,channel?:string}} [input]
 * @returns {{
 *   channel:string,
 *   emitSnapshot:(snapshot?:{pendingCount?:number,pendingBytes?:number}|null)=>void,
 *   syncQueueState:(enabled:boolean)=>void,
 *   clear:()=>void
 * }}
 */
export const createStage1PostingsQueueTelemetry = ({
  runtime = null,
  channel = STAGE1_POSTINGS_QUEUE_TELEMETRY_CHANNEL
} = {}) => {
  /**
   * Publish postings queue in-flight bytes/count to telemetry.
   *
   * @param {{pendingCount?:number,pendingBytes?:number}|null} [snapshot]
   * @returns {void}
   */
  const emitSnapshot = (snapshot = null) => {
    if (!runtime?.telemetry?.setInFlightBytes) return;
    const pendingCount = Number(snapshot?.pendingCount) || 0;
    const pendingBytes = Number(snapshot?.pendingBytes) || 0;
    runtime.telemetry.setInFlightBytes(channel, {
      count: pendingCount,
      bytes: pendingBytes
    });
  };

  /**
   * Synchronize telemetry state when queue is enabled/disabled.
   *
   * @param {boolean} enabled
   * @returns {void}
   */
  const syncQueueState = (enabled) => {
    if (enabled) {
      emitSnapshot({ pendingCount: 0, pendingBytes: 0 });
      return;
    }
    runtime?.telemetry?.clearInFlightBytes?.(channel);
  };

  /**
   * Clear queue telemetry channel.
   *
   * @returns {void}
   */
  const clear = () => {
    runtime?.telemetry?.clearInFlightBytes?.(channel);
  };

  return {
    channel,
    emitSnapshot,
    syncQueueState,
    clear
  };
};
