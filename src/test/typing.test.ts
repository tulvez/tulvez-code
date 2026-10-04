/**
 * Akış durumu testi: düşünüş → metin → istatistik sırasında
 * metin hiçbir koşulda gizlenmemeli.
 */
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useState, useEffect, useRef } from 'react';

function useTyping(full: string, active: boolean, speed = 8) {
  const [index, setIndex] = useState(full.length);
  const lastFull = useRef(full);

  useEffect(() => {
    const grew = full.length > lastFull.current.length;
    lastFull.current = full;
    if (!full) {
      setIndex(0);
      return;
    }
    if (!active || grew) {
      setIndex(full.length);
      return;
    }
    const near = Math.max(0, full.length - 24);
    setIndex((i: number) => (i < near ? near : i));
    if (full.length <= 24) return;
    const id = setInterval(() => {
      setIndex((i: number) => (i >= full.length ? i : Math.min(full.length, i + 4)));
    }, speed);
    return () => clearInterval(id);
  }, [full, active, speed]);

  return { displayed: full.slice(0, index), done: index >= full.length };
}

describe('yazma efekti metni asla gizlemez', () => {
  it('metin boşken tamamen boş döner', () => {
    const { result } = renderHook(() => useTyping('', true));
    expect(result.current.displayed).toBe('');
    expect(result.current.done).toBe(true);
  });

  it('animasyon kapaliyken tam metni gösterir', () => {
    const text = 'Kısa cevap';
    const { result } = renderHook(() => useTyping(text, false));
    expect(result.current.displayed).toBe(text);
    expect(result.current.done).toBe(true);
  });

  it('animasyon aktifken metnin bir kismi gorunur', () => {
    const { result } = renderHook(() => useTyping('Merhaba! Ben Tulvez Code.', true));
    expect(result.current.displayed.length).toBeGreaterThan(0);
  });

  it('metin buyudukce gosterim de buyur (geriye gitmez)', () => {
    const { result, rerender } = renderHook(
      ({ full }: { full: string }) => useTyping(full, true),
      { initialProps: { full: 'bir' } },
    );
    rerender({ full: 'bir iki üç dört' });
    expect(result.current.displayed.length).toBeGreaterThanOrEqual(3);
  });
});