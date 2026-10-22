import { useT } from '../lib/i18n';
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
  const t = useT();
  if (items.length === 0) return null;
  const done = items.filter((t2) => t2.done).length;

  return (
    <div className="tasks">
      <div className="tasks-head">
        <Icon name="list-checks" size="sm" />
        {t('task.title')}
        <span className="cnt">
          {t('task.progress', { done, total: items.length })}
        </span>
      </div>
      {items.map((task) => (
        <div
          key={task.id}
          className={`task-item${task.done ? ' done' : ''}${task.active && !task.done ? ' active' : ''}`}
        >
          <span className="box" aria-hidden="true" />
          <span>{task.text}</span>
        </div>
      ))}
    </div>
  );
}
