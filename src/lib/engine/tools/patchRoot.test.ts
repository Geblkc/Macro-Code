import { describe, expect, it } from 'vitest';
import { applyPendingPatch, listPending, proposePatch } from './patch';

describe('Faz 10 D2a — yama workspace köküne bağlı', () => {
  it('yama üretildiği workspace kökünü taşır', () => {
    const p = proposePatch('a.ts', 'yeni', 'eski', '/proj');
    expect(p.root).toBe('/proj');
    expect(listPending().some((x) => x.id === p.id)).toBe(true);
  });

  it('kök değişmişse yama uygulanmaz (eski workspace yaması yeni köke yazılmaz)', async () => {
    const p = proposePatch('a.ts', 'yeni', 'eski', '/proj-a');
    // Uygulama '/proj-b' kökünde deneniyor → reddedilmeli.
    await expect(applyPendingPatch('/proj-b', p.id)).rejects.toThrow(/farklı workspace/);
  });

  it('aynı kökte yama uygulanmaya çalışılır (Tauri hatası yeterli)', async () => {
    const p = proposePatch('a.ts', 'yeni', 'eski', '/proj-a');
    // Tarayıcı ortamında Rust çağrısı hata verir → "workspace" hatası DEĞİL.
    await expect(applyPendingPatch('/proj-a', p.id)).rejects.not.toThrow(/farklı workspace/);
  });

  it('kök bilinmeyen eski yamalarda uygulama engellenmez (geriye uyum)', async () => {
    const p = proposePatch('a.ts', 'yeni', 'eski'); // root yok
    await expect(applyPendingPatch('/proj-b', p.id)).rejects.not.toThrow(/farklı workspace/);
  });
});
