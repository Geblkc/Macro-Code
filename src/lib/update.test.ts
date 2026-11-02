import { describe, expect, it } from 'vitest';
import {
  UPDATE_CHECK_INTERVAL_MS,
  compactNotes,
  downloadPercent,
  formatBytes,
  isNewerVersion,
  normalizeVersion,
  parseGitHubRelease,
  parseVersion,
  pickAsset,
  releasePageUrl,
  repoSlug,
  shouldCheckNow,
  shouldNotify,
  type DownloadProgress,
} from './update';

/**
 * Güncelleme mantığı — saf yardımcılar.
 *
 * Ağ/updater yolu ayrı test edilir; burada sürüm karşılaştırması, paket
 * seçimi ve açılış bildirimi kuralları doğrulanır. Yanlış semver karşılaştırması
 * kullanıcıya "güncelleme var" diye eski sürümü kurdurur; bu yüzden kritik.
 */

describe('normalizeVersion / parseVersion', () => {
  it('baştaki v ve boşlukları temizler', () => {
    expect(normalizeVersion('  v1.2.3 ')).toBe('1.2.3');
    expect(normalizeVersion('V2.0.0')).toBe('2.0.0');
    expect(normalizeVersion('1.0.0')).toBe('1.0.0');
  });

  it('geçerli semver ayrıştırır', () => {
    expect(parseVersion('1.2.3')).toEqual({ core: [1, 2, 3], pre: [] });
    expect(parseVersion('v0.2.1-beta.2')).toEqual({
      core: [0, 2, 1],
      pre: ['beta', '2'],
    });
  });

  it('geçersiz sürümlerde null döner', () => {
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('abc')).toBeNull();
    expect(parseVersion('1.x.3')).toBeNull();
    expect(parseVersion('1.2.3.4-beta')).not.toBeNull();
  });
});

describe('isNewerVersion', () => {
  it('çekirdek sürümü sayısal karşılaştırır (9 > 10 değil)', () => {
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true);
    expect(isNewerVersion('1.9.0', '1.10.0')).toBe(false);
  });

  it('eksik parçaları 0 sayar', () => {
    expect(isNewerVersion('1.2', '1.2.0')).toBe(false);
    expect(isNewerVersion('1.2.1', '1.2')).toBe(true);
  });

  it('prerelease, normal sürümden küçüktür', () => {
    expect(isNewerVersion('1.0.0', '1.0.0-beta')).toBe(true);
    expect(isNewerVersion('1.0.0-beta', '1.0.0')).toBe(false);
  });

  it('prerelease tanımlayıcılarını semver gibi sıralar', () => {
    expect(isNewerVersion('1.0.0-beta.2', '1.0.0-beta.1')).toBe(true);
    expect(isNewerVersion('1.0.0-rc.1', '1.0.0-beta.9')).toBe(true);
    // Sayısal tanımlayıcı alfanümerik olandan küçüktür.
    expect(isNewerVersion('1.0.0-alpha', '1.0.0-1')).toBe(false);
  });

  it('aynı sürüm daha yeni değildir', () => {
    expect(isNewerVersion('0.2.1', 'v0.2.1')).toBe(false);
  });

  it('geçersiz girdide güvenli tarafta kalır (false)', () => {
    expect(isNewerVersion('invalid', '1.0.0')).toBe(false);
    expect(isNewerVersion('2.0.0', 'invalid')).toBe(false);
  });
});

describe('shouldCheckNow', () => {
  const now = 1_700_000_000_000;

  it('hiç kontrol edilmediyse true', () => {
    expect(shouldCheckNow(0, now)).toBe(true);
    expect(shouldCheckNow(Number.NaN, now)).toBe(true);
    expect(shouldCheckNow(-5, now)).toBe(true);
  });

  it('24 saat dolmadıysa false', () => {
    expect(shouldCheckNow(now - UPDATE_CHECK_INTERVAL_MS + 1, now)).toBe(false);
  });

  it('24 saat dolduysa true', () => {
    expect(shouldCheckNow(now - UPDATE_CHECK_INTERVAL_MS, now)).toBe(true);
  });

  it('özel aralık kullanılabilir', () => {
    expect(shouldCheckNow(now - 500, now, 1000)).toBe(false);
    expect(shouldCheckNow(now - 1000, now, 1000)).toBe(true);
  });
});

describe('shouldNotify', () => {
  it('yok sayılan sürümde bildirim yok', () => {
    expect(shouldNotify('v0.3.0', '0.3.0')).toBe(false);
    expect(shouldNotify('0.3.0', 'v0.3.0')).toBe(false);
  });

  it('yeni sürüm veya boş yok-sayma bildirir', () => {
    expect(shouldNotify('0.3.0', '')).toBe(true);
    expect(shouldNotify('0.3.0', '0.2.0')).toBe(true);
  });
});

describe('pickAsset', () => {
  const assets = [
    { name: 'MacroCode_0.3.0_amd64.deb', url: 'deb' },
    { name: 'MacroCode-0.3.0-1.x86_64.rpm', url: 'rpm' },
    { name: 'MacroCode_0.3.0_amd64.AppImage', url: 'appimage' },
    { name: 'MacroCode_0.3.0_x64-setup.exe', url: 'exe' },
    { name: 'MacroCode_0.3.0_x64_en-US.msi', url: 'msi' },
    { name: 'MacroCode_0.3.0_x64.dmg', url: 'dmg' },
  ];

  it('Linux için AppImage önceliklidir', () => {
    expect(pickAsset(assets, 'linux')?.url).toBe('appimage');
  });

  it('Windows için .exe önceliklidir', () => {
    expect(pickAsset(assets, 'windows')?.url).toBe('exe');
  });

  it('macOS için .dmg seçilir', () => {
    expect(pickAsset(assets, 'macos')?.url).toBe('dmg');
  });

  it('uygun paket yoksa null', () => {
    expect(pickAsset([], 'linux')).toBeNull();
    expect(pickAsset(assets, 'unknown')).toBeNull();
  });
});

describe('parseGitHubRelease', () => {
  const raw = {
    tag_name: 'v0.3.0',
    html_url: 'https://github.com/o/r/releases/tag/v0.3.0',
    body: '# Notlar\n- düzeltme',
    published_at: '2026-01-02T03:04:05Z',
    assets: [
      {
        name: 'MacroCode_0.3.0_amd64.AppImage',
        browser_download_url: 'https://example.test/appimage',
        size: 1234,
      },
      { name: '', browser_download_url: 'https://example.test/x' },
      { name: 'no-url' },
      null,
    ],
  };

  it('geçerli release JSON’unu çevirir', () => {
    const info = parseGitHubRelease(raw, '0.2.0');
    expect(info).not.toBeNull();
    expect(info?.version).toBe('0.3.0');
    expect(info?.currentVersion).toBe('0.2.0');
    expect(info?.notes).toContain('düzeltme');
    expect(info?.date).toBe('2026-01-02T03:04:05Z');
    expect(info?.source).toBe('github');
    // Geçersiz/silinmiş varlıklar atılır.
    expect(info?.assets).toEqual([
      {
        name: 'MacroCode_0.3.0_amd64.AppImage',
        url: 'https://example.test/appimage',
        size: 1234,
      },
    ]);
  });

  it('tag geçersizse null', () => {
    expect(parseGitHubRelease({ tag_name: 'not-a-version' })).toBeNull();
    expect(parseGitHubRelease(null)).toBeNull();
    expect(parseGitHubRelease('x')).toBeNull();
  });

  it('html_url yoksa release sayfası türetilir', () => {
    const info = parseGitHubRelease({ tag_name: '1.2.3' }, '1.0.0');
    expect(info?.url).toContain('/releases/tag/v1.2.3');
  });
});

describe('repoSlug / releasePageUrl', () => {
  it('GitHub URL’sinden owner/repo çıkarır', () => {
    expect(repoSlug('https://github.com/Geblkc/Macro-Code')).toBe('Geblkc/Macro-Code');
    expect(repoSlug('https://github.com/Geblkc/Macro-Code.git')).toBe('Geblkc/Macro-Code');
    expect(repoSlug('git@github.com:owner/repo.git')).toBe('owner/repo');
  });

  it('GitHub olmayan URL’de null', () => {
    expect(repoSlug('https://gitlab.com/o/r')).toBeNull();
    expect(repoSlug('')).toBeNull();
  });

  it('release sayfası sürümle veya genel olabilir', () => {
    expect(releasePageUrl('v1.2.3')).toMatch(/\/releases\/tag\/v1\.2\.3$/);
    expect(releasePageUrl()).toMatch(/\/releases$/);
  });
});

describe('downloadPercent / formatBytes', () => {
  const base = (downloaded: number, total: number): DownloadProgress => ({
    phase: 'progress',
    downloaded,
    total,
  });

  it('toplam bilinmiyorsa -1', () => {
    expect(downloadPercent(base(100, 0))).toBe(-1);
    expect(downloadPercent(base(0, -1))).toBe(-1);
  });

  it('yüzdeyi 0-100 aralığına kilitler', () => {
    expect(downloadPercent(base(0, 1000))).toBe(0);
    expect(downloadPercent(base(500, 1000))).toBe(50);
    expect(downloadPercent(base(1500, 1000))).toBe(100);
  });

  it('baytı okunur biçime çevirir', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(10 * 1024)).toBe('10 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });
});

describe('compactNotes', () => {
  it('satırları tek satıra indirir', () => {
    expect(compactNotes('# Başlık\n\n- madde\r\n- ikinci')).toBe(
      '# Başlık · - madde · - ikinci',
    );
  });

  it('uzun notu kısaltır', () => {
    const out = compactNotes('a'.repeat(400), 20);
    expect(out.length).toBe(20);
    expect(out.endsWith('…')).toBe(true);
  });
});
