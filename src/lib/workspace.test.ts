/**
 * Klasör seçme altyapısı — saf çekirdek testleri.
 * (Rust diyaloğu/invokeları Tauri runtime'ı ister; vitest yalnızca SAF katmanı
 * + store recents mantığını kapsar. pickWorkspaceFolder/checkRootExists'i
 * çalıştırmak mocking ister — tarayıcı dev'de null/true korumaları ayrıca
 * composable test edilir: isTauri false → davranış belirlenmiştir.)
 */
import { describe, expect, it } from 'vitest';
import {
  checkRootExists,
  FORBIDDEN_ROOT_SEGS,
  labelOfRoot,
  normalizeRoot,
  rootForbidCode,
  rootForbidKey,
  validateRootInput,
} from './workspace';
import { pushRecent, RECENT_MAX, type WorkspaceRecentEntry } from '../store/workspace';

describe('workspace — normalizeRoot', () => {
  it('ters eğik çizgiyi düz eğik çizgiye çevirir (Windows yapıştırma)', () => {
    expect(normalizeRoot('C:\\Users\\ali\\proj')).toBe('C:/Users/ali/proj');
  });

  it('sondaki ayraçları siler, trim yapar', () => {
    expect(normalizeRoot('  /home/ali/proje/  ')).toBe('/home/ali/proje');
    expect(normalizeRoot('/home/ali/proje///')).toBe('/home/ali/proje');
  });

  it('boş ve tek kök ayraç korunur', () => {
    expect(normalizeRoot('  ')).toBe('');
    expect(normalizeRoot('/')).toBe('/');
  });

  it('sufle boşluklu yola label üretir', () => {
    expect(labelOfRoot('/home/ali/proje/')).toBe('proje');
  });
});

describe('workspace — labelOfRoot', () => {
  it('son bileşeni verir', () => {
    expect(labelOfRoot('/home/ali/proje')).toBe('proje');
  });

  it('gerçek boşlukta yolun kendisini verir', () => {
    expect(labelOfRoot('/')).toBe('/');
    expect(labelOfRoot('')).toBe('');
  });
});

describe('workspace — rootForbidCode (SAF reddetmeler)', () => {
  it('meşru proje yolu reddedilmez', () => {
    expect(rootForbidCode('/home/ali/proje')).toBeNull();
    expect(rootForbidCode('C:/Users/ali/proj')).toBeNull();
    expect(rootForbidCode('/Users/ali/proje')).toBeNull();
  });

  it('boş ve bağıl yollar reddedilir', () => {
    expect(rootForbidCode('')).toBe('empty');
    expect(rootForbidCode('./proje')).toBe('relative');
    expect(rootForbidCode('proje')).toBe('relative');
  });

  it('dosya sistemi kökleri reddedilir', () => {
    expect(rootForbidCode('/')).toBe('root');
    expect(rootForbidCode('/etc')).toBe('root');
    expect(rootForbidCode('/proc')).toBe('root');
    expect(rootForbidCode('C:/Windows')).toBe('root');
    expect(rootForbidCode('C:')).toBe('relative'); // sürücü harfi ayraçsız → mutlak değil
  });

  it('home bütünüyle reddedilir, alt kılasör serbest', () => {
    expect(rootForbidCode('/home/ali')).toBe('home');
    expect(rootForbidCode('/Users/ali')).toBe('home');
    expect(rootForbidCode('/home/ali/proje')).toBeNull();
    expect(rootForbidCode('/home/ali/.ssh')).toBe('sensitive'); // önce home değil, derin reddet
  });

  it('hassas adlar derinde bile reddedilir', () => {
    expect(rootForbidCode('/home/ali/.gnupg')).toBe('sensitive');
    expect(rootForbidCode('C:/Users/ali/AppData')).toBe('sensitive');
    expect(rootForbidCode('/eks/proj/.aws')).toBe('sensitive');
  });

  it('blocks.json adları (node_modules/.git) kök olarak seçilebilir', () => {
    // Meşru ama tuhaf adlı proje klasörleri reddedilmemeli — isBlockedDir
    // bileşen bazlıdır; burada yalnızca gerçek hassaslıklar (.ssh…) reddedilir.
    expect(rootForbidCode('/home/ali/node_modules')).toBeNull();
    expect(rootForbidCode('/home/ali/dist')).toBeNull();
  });

  it('FORBIDDEN_ROOT_SEGS küçük harf tutarlı', () => {
    for (const seg of FORBIDDEN_ROOT_SEGS) expect(seg).toBe(seg.toLowerCase());
  });
});

describe('workspace — rootForbidKey / validateRootInput', () => {
  it('kod null ise anahtar da null', () => {
    expect(rootForbidKey(null)).toBeNull();
    expect(rootForbidKey('root')).toBe('workspace.forbid.root');
  });

  it('geçerli yol → normalize + label', () => {
    const r = validateRootInput('  /home/ali/proje/');
    expect(r).toEqual({ ok: true, root: '/home/ali/proje', label: 'proje' });
  });

  it('geçersiz yol → i18n anahtarı', () => {
    const r = validateRootInput('C:/Windows');
    expect(r).toEqual({ ok: false, key: 'workspace.forbid.root' });
  });
});

describe('workspace — checkRootExists (tarayıcı-dev korunması)', () => {
  it('Tauri dışında kontrolsüz geçer (dev kolaylığı)', async () => {
    await expect(checkRootExists('/home/yok')).resolves.toBe(true);
  });
});

describe('workspace — pushRecent (recents saf güncelleme)', () => {
  it('yeni seçim başa alınır', () => {
    const list: WorkspaceRecentEntry[] = [
      { root: '/a', label: 'a' },
      { root: '/b', label: 'b' },
    ];
    const next = pushRecent(list, '/c');
    expect(next.map((e) => e.root)).toEqual(['/c', '/a', '/b']);
    expect(next[0].label).toBe('c'); // labelOfRoot
  });

  it('tekrar seçim başa taşınır (copy yok)', () => {
    const list: WorkspaceRecentEntry[] = [
      { root: '/a', label: 'a' },
      { root: '/b', label: 'b' },
    ];
    const next = pushRecent(list, '/b');
    expect(next.map((e) => e.root)).toEqual(['/b', '/a']);
    expect(next).toHaveLength(2);
  });

  it('RECENT_MAX cap — en eski düşer', () => {
    let list: WorkspaceRecentEntry[] = [];
    for (let i = 0; i < RECENT_MAX + 2; i++) list = pushRecent(list, `/${i}`);
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0].root).toBe(`/${RECENT_MAX + 1}`);
    expect(list.at(-1)!.root).toBe('/2');
  });
});
