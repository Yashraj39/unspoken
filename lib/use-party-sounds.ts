'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// All sounds are made on the device. No audio service or gameplay data is used.
export function usePartySounds() {
  const [enabled, setEnabled] = useState(true);
  const enabledRef = useRef(true);
  const context = useRef<AudioContext | null>(null);
  const scheduled = useRef<AudioScheduledSourceNode[]>([]);

  const stop = useCallback(() => {
    for (const node of scheduled.current) { try { node.stop(); } catch {} }
    scheduled.current = [];
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.resolve().then(() => {
      try {
        const value = localStorage.getItem('unspoken-sound') !== 'off';
        enabledRef.current = value;
        if (mounted) setEnabled(value);
      } catch {}
    });
    const visibility = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { mounted = false; stop(); document.removeEventListener('visibilitychange', visibility); void context.current?.close(); };
  }, [stop]);

  const unlock = useCallback(() => {
    if (!enabledRef.current) return;
    try {
      if (!context.current) {
        const Constructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Constructor) context.current = new Constructor();
      }
      if (context.current?.state === 'suspended') void context.current.resume().catch(() => {});
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    const value = !enabledRef.current;
    enabledRef.current = value;
    setEnabled(value);
    try { localStorage.setItem('unspoken-sound', value ? 'on' : 'off'); } catch {}
    if (value) unlock(); else stop();
  }, [unlock, stop]);

  const sound = useCallback((kind: 'roll' | 'pop') => {
    const ctx = context.current;
    if (!enabledRef.current || !ctx || ctx.state !== 'running' || document.hidden) return;
    stop();
    const sources: AudioScheduledSourceNode[] = [];
    const remember = (source: AudioScheduledSourceNode, nodes: AudioNode[]) => {
      sources.push(source);
      source.onended = () => { nodes.forEach(node => node.disconnect()); scheduled.current = scheduled.current.filter(node => node !== source); };
    };
    const noise = (at: number, duration: number, volume: number, frequency: number) => {
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
      const values = buffer.getChannelData(0);
      for (let i = 0; i < values.length; i++) values[i] = Math.random() * 2 - 1;
      const source = ctx.createBufferSource(); source.buffer = buffer;
      const filter = ctx.createBiquadFilter(); filter.type = 'highpass'; filter.frequency.value = frequency;
      const gain = ctx.createGain(); gain.gain.setValueAtTime(volume, at); gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
      source.connect(filter).connect(gain).connect(ctx.destination);
      remember(source, [source, filter, gain]); source.start(at); source.stop(at + duration);
    };
    const tone = (at: number, frequency: number, duration: number, volume: number, kick = false) => {
      const source = ctx.createOscillator(); source.type = 'sine'; source.frequency.setValueAtTime(frequency, at);
      if (kick) source.frequency.exponentialRampToValueAtTime(48, at + duration);
      const gain = ctx.createGain(); gain.gain.setValueAtTime(0.001, at); gain.gain.exponentialRampToValueAtTime(volume, at + 0.007); gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
      source.connect(gain).connect(ctx.destination); remember(source, [source, gain]); source.start(at); source.stop(at + duration);
    };
    const start = ctx.currentTime + 0.015;
    if (kind === 'roll') {
      for (let i = 0; i < 22; i++) {
        const at = start + 1.47 * (1 - Math.pow(1 - i / 22, 1.5));
        noise(at, 0.075, 0.065 + i * 0.0025, 1400);
        tone(at, 170, 0.055, 0.08, true);
      }
      tone(start, 110, 0.18, 0.12, true);
    } else {
      noise(start, 0.12, 0.19, 800);
      tone(start, 130, 0.15, 0.17, true);
      [523.25, 659.25, 783.99].forEach((frequency, i) => tone(start + 0.055 + i * 0.055, frequency, 0.28, 0.07));
    }
    scheduled.current = sources;
  }, [stop]);

  return { enabled, unlock, toggle, stop, sound };
}
