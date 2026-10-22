import { describe, expect, it } from 'vitest';
import { mergeVisited, nextTabIndex, TABS, type TabId } from './types';

describe('nextTabIndex — sekme rayı klavye navigasyonu', () => {
  const count = 6;

  it('aşağı/sağ tuşu sonraki sekmeye gider', () => {
    expect(nextTabIndex('ArrowDown', 0, count)).toBe(1);
    expect(nextTabIndex('ArrowRight', 2, count)).toBe(3);
  });

  it('yukarı/sol tuşu önceki sekmeye gider', () => {
    expect(nextTabIndex('ArrowUp', 3, count)).toBe(2);
    expect(nextTabIndex('ArrowLeft', 0, count)).toBe(count - 1);
  });

  it('ilk sekmede yukarı → son sekme, son sekmede aşağı → ilk sekme (döngü)', () => {
    expect(nextTabIndex('ArrowUp', 0, count)).toBe(5);
    expect(nextTabIndex('ArrowDown', 5, count)).toBe(0);
  });

  it('Home başa, End sona gider', () => {
    expect(nextTabIndex('Home', 4, count)).toBe(0);
    expect(nextTabIndex('End', 1, count)).toBe(count - 1);
  });

  it('ilgisiz tuşlar iş yapmaz (-1)', () => {
    expect(nextTabIndex('Tab', 0, count)).toBe(-1);
    expect(nextTabIndex('Enter', 0, count)).toBe(-1);
    expect(nextTabIndex('a', 2, count)).toBe(-1);
  });

  it('geçersiz durumlarda -1 döner', () => {
    expect(nextTabIndex('ArrowDown', 0, 0)).toBe(-1);
    expect(nextTabIndex('ArrowDown', -1, count)).toBe(-1);
  });
});

describe('mergeVisited — ziyaret edilen sekmeler', () => {
  it('yeni sekmeyi listeye ekler', () => {
    expect(mergeVisited(['providers'], 'models')).toEqual(['providers', 'models']);
  });

  it('aynı sekmeyi tekrar eklemez (referans korunur)', () => {
    const list: TabId[] = ['providers', 'models'];
    expect(mergeVisited(list, 'models')).toBe(list);
  });
});

describe('TABS — sekme tanımları', () => {
  it('her sekme id benzersizdir', () => {
    const ids = TABS.map((tb) => tb.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('her sekmenin ikonu ve etiketi var', () => {
    for (const tb of TABS) {
      expect(tb.icon).toBeTruthy();
      expect(tb.labelKey).toBeTruthy();
    }
  });
});
