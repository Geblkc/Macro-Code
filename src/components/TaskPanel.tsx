import { Icon } from './icons';

export interface TaskItem {
  id: string;
  text: string;
  done: boolean;
  active?: boolean;
}

interface Props {
  items: TaskItem[];
}

export default function TaskPanel({ items }: Props) {
  if (items.length === 0) return null;
  const done = items.filter((t) => t.done).length;

  return (
    <div className="tasks">
      <div className="tasks-head">
        <Icon name="list-checks" size="sm" />
        Görevler
        <span className="cnt">
          {done}/{items.length} tamamlandı
        </span>
      </div>
      {items.map((t) => (
        <div
          key={t.id}
          className={`task-item${t.done ? ' done' : ''}${t.active && !t.done ? ' active' : ''}`}
        >
          <span className="box" aria-hidden="true" />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
