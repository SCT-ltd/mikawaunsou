let audioCtx: AudioContext | null = null;
const notifiedMessageIds = new Set<number>();

function getAudioContext(): AudioContext | null {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export function unlockAudio(): void {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

function _playBeep(ctx: AudioContext): void {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, ctx.currentTime);
  oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.12);

  gainNode.gain.setValueAtTime(0, ctx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + 0.4);
}

/** 操作フィードバック用の単発ビープ（打刻成功時など）。メッセージ通知の重複抑止は行わない。 */
export function playFeedbackSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume()
      .then(() => _playBeep(ctx))
      .catch(() => {});
    return;
  }

  _playBeep(ctx);
}

export function playNotificationSound(
  messageId: number,
  options?: { senderId?: number; conversationId?: number; currentUserId?: number }
): void {
  if (notifiedMessageIds.has(messageId)) {
    console.log("[MESSAGE_NOTIFICATION_SOUND]", {
      messageId,
      ...options,
      shouldPlaySound: false,
      reason: "already_notified",
    });
    return;
  }
  notifiedMessageIds.add(messageId);

  console.log("[MESSAGE_NOTIFICATION_SOUND]", {
    messageId,
    ...options,
    shouldPlaySound: true,
    reason: "new_message_from_other",
  });

  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    ctx.resume()
      .then(() => _playBeep(ctx))
      .catch(() => {});
    return;
  }

  _playBeep(ctx);
}
