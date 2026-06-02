import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import deckFinalData from '../../../data/deck_final.json';
import { getSafeImageUrl, cardBackImg } from '../../../utils/cardHelpers';

// Ascending: Red → Green → Blue → Purple → Black → Yellow
const COLOR_ORDER = ['red', 'green', 'blue', 'purple', 'black', 'yellow'];

// Parse "OP05-098" → { prefix:"OP", set:5, card:98 } for correct numeric sort
function parseCardId(id = '') {
  const m = id.match(/^([A-Za-z]+)(\d+)-(\d+)$/);
  if (!m) return { prefix: id, set: 0, card: 0 };
  return { prefix: m[1].toUpperCase(), set: parseInt(m[2], 10), card: parseInt(m[3], 10) };
}
function compareCardIds(a, b) {
  const pa = parseCardId(a), pb = parseCardId(b);
  if (pa.prefix !== pb.prefix) return pa.prefix.localeCompare(pb.prefix);
  if (pa.set !== pb.set)       return pa.set - pb.set;
  return pa.card - pb.card;
}

export default function AiDeckPicker({ cards, ggDecksData = {}, officialDecksData = [], prevMetaData = {}, onSelect, onClose }) {
  const { t, i18n } = useTranslation();
  const isEn = i18n.language.startsWith('en');

  const [source,   setSource]   = useState('meta');
  const [selected, setSelected] = useState(null);
  const [sortBy,   setSortBy]   = useState('default');
  const [sortDir,  setSortDir]  = useState('asc'); // 'asc' | 'desc'

  const handleSourceChange = (s) => { setSource(s); setSelected(null); };

  const handleSortClick = (key) => {
    if (key === sortBy) {
      // Toggle direction (default has no meaningful direction)
      if (key !== 'default') setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const SORT_MODES = [
    { key: 'default', label: isEn ? 'Default' : '預設' },
    { key: 'number',  label: isEn ? 'No.'     : '卡號' },
    { key: 'color',   label: isEn ? 'Color'   : '顏色' },
    { key: 'name',    label: isEn ? 'Name'    : '名稱' },
  ];

  // ── Entry builders ──────────────────────────────────────────────────────────
  const metaEntries = useMemo(() =>
    Object.entries(deckFinalData).map(([key, val]) => ({
      key,
      deckStr:   val.deck,
      leaderId:  key,
      leader:    cards?.find(c => c.id === key) ?? null,
      sortCount: val.count ?? 0,
      sortDate:  '',
    })),
  [cards]);

  const latestEntries = useMemo(() =>
    Object.entries(ggDecksData).map(([key, val]) => ({
      key,
      deckStr:   val.deck,
      leaderId:  key,
      leader:    cards?.find(c => c.id === key) ?? null,
      sortCount: 0,
      sortDate:  val.event_date ?? '',
    })),
  [cards, ggDecksData]);

  const officialEntries = useMemo(() =>
    (officialDecksData || []).map(entry => {
      const deckIds = new Set(
        entry.deck.split(',').map(s => s.replace(/^\d+x/, '').toUpperCase())
      );
      const leader = cards?.find(
        c => deckIds.has(c.id.toUpperCase()) && (c.category === 'Leader' || c.category === '領航')
      ) ?? cards?.find(c => c.id.toUpperCase() === entry.leader.toUpperCase()) ?? null;
      return {
        key:       String(entry.id),
        deckStr:   entry.deck,
        leaderId:  leader?.id ?? entry.leader,
        leader,
        sortCount: 0,
        sortDate:  entry.date ?? '',
        name:      entry.name,
      };
    }),
  [cards, officialDecksData]);

  const prevMetaEntries = useMemo(() =>
    Object.entries(prevMetaData).map(([key, val]) => ({
      key,
      deckStr:   val.deck,
      leaderId:  key,
      leader:    cards?.find(c => c.id === key) ?? null,
      sortCount: val.count ?? 0,
      sortDate:  '',
    })),
  [cards, prevMetaData]);

  const activeEntries = source === 'meta'     ? metaEntries
    : source === 'latest'   ? latestEntries
    : source === 'prevmeta' ? prevMetaEntries
    : officialEntries;

  // ── Sort ────────────────────────────────────────────────────────────────────
  const sortedEntries = useMemo(() => {
    const entries = [...activeEntries];
    const dir = sortDir === 'asc' ? 1 : -1;

    if (sortBy === 'default') {
      // Default: popularity (meta/prevmeta) or newest-first (others) — fixed descending
      if (source === 'meta' || source === 'prevmeta') entries.sort((a, b) => b.sortCount - a.sortCount);
      else                                            entries.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
    } else if (sortBy === 'number') {
      entries.sort((a, b) => dir * compareCardIds(a.leaderId, b.leaderId));
    } else if (sortBy === 'color') {
      entries.sort((a, b) => {
        const ia = COLOR_ORDER.indexOf((a.leader?.colors?.[0] ?? '').toLowerCase());
        const ib = COLOR_ORDER.indexOf((b.leader?.colors?.[0] ?? '').toLowerCase());
        return dir * ((ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib));
      });
    } else if (sortBy === 'name') {
      entries.sort((a, b) =>
        dir * leaderName(a).localeCompare(leaderName(b))
      );
    }
    return entries;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEntries, sortBy, sortDir, source, isEn]);

  const selectedEntry = selected ? sortedEntries.find(d => d.key === selected) : null;

  function leaderName(entry) {
    if (!entry?.leader) return entry?.key ?? '';
    return isEn ? (entry.leader.enName ?? entry.leader.name) : entry.leader.name;
  }

  const SOURCES = [
    { key: 'meta',     label: isEn ? 'Meta'      : t('topdecks_source'), color: 'bg-violet-600' },
    { key: 'latest',   label: isEn ? 'Latest'    : t('gumgum_source'),   color: 'bg-teal-600'   },
    { key: 'prevmeta', label: isEn ? 'Prev Meta' : '前代環境',           color: 'bg-slate-600'  },
    { key: 'official', label: isEn ? 'Official'  : '官方',               color: 'bg-amber-600'  },
  ];

  return (
    <div className="fixed inset-0 bg-slate-950 flex flex-col z-50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 border-b border-slate-800">
        <button onClick={onClose} className="text-slate-400 hover:text-white text-sm font-bold">
          ← {isEn ? 'Back' : '返回'}
        </button>
        <span className="text-slate-300 font-black text-sm tracking-wide">
          {isEn ? 'Choose Opponent Deck' : '選擇對手牌組'}
        </span>
        <span className="text-xs text-slate-500">{activeEntries.length}</span>
      </div>

      {/* Source tabs */}
      <div className="flex gap-1.5 px-3 pt-2 pb-1">
        {SOURCES.map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => handleSourceChange(key)}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all
              ${source === key ? `${color} text-white` : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Sort bar */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-slate-800">
        <span className="text-slate-500 text-[10px] font-bold flex-shrink-0 mr-0.5">
          {isEn ? 'Sort:' : '排序:'}
        </span>
        {SORT_MODES.map(({ key, label }) => {
          const isActive = sortBy === key;
          const showArrow = isActive && key !== 'default';
          return (
            <button
              key={key}
              onClick={() => handleSortClick(key)}
              className={`flex-1 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center justify-center gap-px
                ${isActive
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
            >
              {label}
              {showArrow && (
                <span className="text-[11px] leading-none">
                  {sortDir === 'asc' ? '↑' : '↓'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Deck grid */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="grid grid-cols-3 gap-3">
          {sortedEntries.map((entry) => {
            const isSelected = selected === entry.key;
            return (
              <button
                key={entry.key}
                onClick={() => setSelected(entry.key)}
                className={`relative flex flex-col items-center rounded-xl border-2 overflow-hidden transition-all active:scale-95
                  ${isSelected
                    ? 'border-blue-400 shadow-lg shadow-blue-500/30 scale-105'
                    : 'border-slate-700 opacity-80'
                  }`}
              >
                <div className="relative w-full overflow-hidden bg-slate-800" style={{ height: '5rem' }}>
                  <img
                    src={entry.leader ? getSafeImageUrl(entry.leader) : cardBackImg}
                    alt={leaderName(entry)}
                    className="absolute"
                    style={{ width: '160%', left: '50%', transform: 'translateX(-50%) translateY(-10%)' }}
                    onError={e => { e.target.src = cardBackImg; }}
                  />
                </div>
                <div className="w-full bg-slate-900 px-1 py-1.5">
                  <p className="text-white text-[9px] font-bold truncate text-center leading-tight">
                    {leaderName(entry)}
                  </p>
                  <p className="text-slate-500 text-[8px] text-center mt-0.5">
                    {source === 'latest' ? entry.sortDate : entry.leaderId}
                  </p>
                </div>
                {isSelected && (
                  <div className="absolute top-1 right-1 bg-blue-600 rounded-full w-5 h-5 flex items-center justify-center shadow">
                    <span className="text-white text-[11px] font-black">✓</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Confirm */}
      <div className="px-4 pb-8 pt-3 border-t border-slate-800">
        <button
          onClick={() => selectedEntry && onSelect({ deckStr: selectedEntry.deckStr, leaderId: selectedEntry.leaderId })}
          disabled={!selectedEntry}
          className={`w-full py-4 font-black text-sm rounded-2xl active:scale-95 transition-all
            ${selectedEntry
              ? 'bg-blue-600 hover:bg-blue-500 text-white'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
        >
          {selectedEntry
            ? `${isEn ? 'Challenge' : '挑戰'} ${leaderName(selectedEntry)}`
            : isEn ? 'Select an opponent deck' : '請選擇對手牌組'}
        </button>
      </div>
    </div>
  );
}
