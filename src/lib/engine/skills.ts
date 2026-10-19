/**
 * Faz G — Skill registry.
 * İleride MCP/JS plugin yükleme buraya bağlanır; şimdilik statik kayıt.
 */
export interface Skill {
  name: string;
  description: string;
  /** Agent system prompt'una eklenen talimat. */
  prompt: string;
}

const registry = new Map<string, Skill>();

export function registerSkill(skill: Skill): void {
  const name = skill.name.trim().toLowerCase();
  if (!name) throw new Error('skill adı boş olamaz');
  if (!/^[a-z0-9-_]{2,32}$/.test(name)) {
    throw new Error('skill adı: [a-z0-9-_], 2-32 karakter');
  }
  registry.set(name, { ...skill, name });
}

export function listSkills(): Skill[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function getSkill(name: string): Skill | undefined {
  return registry.get(name.trim().toLowerCase());
}

export function clearSkills(): void {
  registry.clear();
}

export function skillsPrompt(names: string[]): string {
  const found = names
    .map((n) => getSkill(n))
    .filter((s): s is Skill => !!s);
  if (found.length === 0) return '';
  return found.map((s) => `[skill:${s.name}] ${s.prompt}`).join('\n');
}

// Yerleşik örnek skill (dosya okuma disiplini).
registerSkill({
  name: 'repo-guide',
  description: 'Projeyi değiştirmeden önce ilgili dosyaları oku',
  prompt: 'Kod değiştirmeden önce read_file/list_dir/grep ile ilgili dosyaları oku. Varsayım yapma.',
});
