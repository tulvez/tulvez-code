import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Search } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { L } from '../lib/i18n';
import { prettyModel } from '../lib/modelName';

export const DEFAULT_MODEL = 'Varsayılan';

// Model seçimi: aranabilir liste, okunur ad + ham kimlik.
// Sohbetteki model düğmesi ve Ayarlar aynı menüyü kullanır.
export function ModelMenu({ value, models, onSelect, trigger, allowDefault = true, side = 'top', align = 'start', emptyText }: {
  value: string;
  models: string[];
  onSelect: (model: string) => void;
  trigger: ReactNode;
  allowDefault?: boolean;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
  emptyText?: string;
}) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const q = search.trim().toLowerCase();
  const filtered = q
    ? models.filter((m) => m.toLowerCase().includes(q) || prettyModel(m).toLowerCase().includes(q))
    : models;
  const list = allowDefault && !q ? [DEFAULT_MODEL, ...filtered] : filtered;

  return (
    <DropdownMenu modal={false} onOpenChange={(open) => { if (open) { setSearch(''); setTimeout(() => inputRef.current?.focus(), 50); } }}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="tz-menu tz-menu-models"
        onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="tz-menu-search">
          <Search size={12} />
          <input
            ref={inputRef}
            type="text"
            placeholder={L('Model ara', 'Search models')}
            value={search}
            spellCheck={false}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          {models.length > 0 && <span className="tz-menu-count">{filtered.length}</span>}
        </div>
        <div className="tz-menu-scroll">
          {list.map((m) => (
            <DropdownMenuItem key={m} className={`tz-menu-item tz-model-item ${value === m ? 'is-on' : ''}`} onSelect={() => onSelect(m)}>
              <span className="tz-model-text">
                <span className="tz-model-name">{m === DEFAULT_MODEL ? L('Varsayılan model', 'Default model') : prettyModel(m)}</span>
                <span className="tz-model-id" title={m}>{m === DEFAULT_MODEL ? L('Ayarlarda seçilen model', 'The model chosen in Settings') : m}</span>
              </span>
              {value === m && <Check size={12} className="tz-menu-check" />}
            </DropdownMenuItem>
          ))}
          {list.length === 0 && (
            <div className="tz-menu-empty">{q ? L(`"${search}" ile eşleşen model yok`, `No model matches "${search}"`) : (emptyText ?? L('Model listesi boş', 'The model list is empty'))}</div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
