import { useState } from 'react';
import {
  CalendarClock,
  Check,
  FilterX,
  ListFilter,
  Route,
  Tag,
  type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  FilterChip,
  FilterChipOperator,
  FilterChipRemove,
  FilterChipSubject,
  FilterChipValue,
} from '@/components/ui/filter-chip';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { GameIcon } from '@/GameIcon';
import type { GameCatalog } from '@/games';
import { cn } from '@/lib/utils';
import type { Game } from '@town-map/contracts';

export type DateFilter =
  | 'all'
  | 'today'
  | 'tomorrow'
  | '3days'
  | 'week'
  | 'month';
export type PriceFilter = 'all' | 'free' | 'under10' | 'under25';
type FilterId = 'date' | 'distance' | 'price';

export const DATE_OPTIONS: Array<{
  value: DateFilter;
  label: string;
  chip: string;
  operator: string;
}> = [
  { value: 'all', label: 'Any time', chip: 'Any time', operator: 'is' },
  { value: 'today', label: 'Today', chip: 'Today', operator: 'on' },
  { value: 'tomorrow', label: 'Tomorrow', chip: 'Tomorrow', operator: 'on' },
  { value: '3days', label: 'Next 3 days', chip: '3 days', operator: 'within' },
  { value: 'week', label: 'Next 7 days', chip: '7 days', operator: 'within' },
  { value: 'month', label: 'Next 30 days', chip: '30 days', operator: 'within' },
];

export const PRICE_OPTIONS: Array<{
  value: PriceFilter;
  label: string;
  chip: string;
  operator: string;
}> = [
  { value: 'all', label: 'Any price', chip: 'Any price', operator: 'is' },
  { value: 'free', label: 'Free', chip: 'Free', operator: 'is' },
  { value: 'under10', label: 'Under $10', chip: '$10', operator: 'under' },
  { value: 'under25', label: 'Under $25', chip: '$25', operator: 'under' },
];

const RADIUS_PRESETS = [5, 10, 25, 50, 100];

export const DEFAULT_RADIUS_MILES = 25;

const FILTERS: Record<
  FilterId,
  { label: string; icon: LucideIcon }
> = {
  date: { label: 'Occurs', icon: CalendarClock },
  distance: { label: 'Distance', icon: Route },
  price: { label: 'Price', icon: Tag },
};

const FILTER_ORDER: FilterId[] = ['date', 'distance', 'price'];

export type FilterBarValue = {
  dateFilter: DateFilter;
  radiusMiles: number;
  games: Game[];
  price: PriceFilter;
};

type FilterBarProps = {
  value: FilterBarValue;
  onChange: (next: Partial<FilterBarValue>) => void;
  catalog: GameCatalog;
  /** Games the user selects by default — their saved preferences. */
  defaultGames: Game[];
  resultCount: number;
  className?: string;
  /** Game chips live on GamePills; hide them here so they aren't duplicated. */
  showGames?: boolean;
  showDate?: boolean;
};

function optionRowClasses(selected: boolean) {
  return cn(
    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors cursor-pointer',
    'hover:bg-muted focus-visible:bg-muted',
    selected && 'font-medium',
  );
}

export function FilterBar({
  value,
  onChange,
  catalog,
  defaultGames,
  resultCount,
  className,
  showGames = true,
  showDate = true,
}: FilterBarProps) {
  const filterOrder = FILTER_ORDER.filter(id => showDate || id !== 'date');
  const [active, setActive] = useState<FilterId[]>(() =>
    filterOrder.filter(id =>
      id === 'date'
        ? value.dateFilter !== 'all'
        : id === 'distance'
          ? value.radiusMiles !== DEFAULT_RADIUS_MILES
          : value.price !== 'all',
    ),
  );
  const [openFilter, setOpenFilter] = useState<FilterId | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [radiusDraft, setRadiusDraft] = useState('');

  const availableFilters = filterOrder.filter(id => !active.includes(id));
  const availableGames = showGames
    ? catalog.ids.filter(game => !value.games.includes(game))
    : [];

  const dateOption =
    DATE_OPTIONS.find(option => option.value === value.dateFilter) ??
    DATE_OPTIONS[0];
  const priceOption =
    PRICE_OPTIONS.find(option => option.value === value.price) ??
    PRICE_OPTIONS[0];

  const operators: Record<FilterId, string> = {
    date: dateOption.operator,
    distance: 'within',
    price: priceOption.operator,
  };

  const summaries: Record<FilterId, string> = {
    date: dateOption.chip,
    distance: `${value.radiusMiles} mi`,
    price: priceOption.chip,
  };

  function addFilter(id: FilterId) {
    setActive(current => (current.includes(id) ? current : [...current, id]));
    setAddMenuOpen(false);
    setTimeout(() => setOpenFilter(id), 0);
  }

  function removeFilter(id: FilterId) {
    setActive(current => current.filter(item => item !== id));
    if (id === 'date') onChange({ dateFilter: 'all' });
    if (id === 'distance') onChange({ radiusMiles: DEFAULT_RADIUS_MILES });
    if (id === 'price') onChange({ price: 'all' });
  }

  function clearAll() {
    setActive([]);
    onChange({
      dateFilter: 'all',
      radiusMiles: DEFAULT_RADIUS_MILES,
      games: [],
      price: 'all',
    });
  }

  function commitRadiusDraft() {
    const parsed = Number(radiusDraft);
    if (Number.isFinite(parsed) && parsed > 0) {
      onChange({ radiusMiles: Math.min(500, Math.round(parsed)) });
    }
    setRadiusDraft('');
  }

  function renderPopoverBody(id: FilterId) {
    if (id === 'date' || id === 'price') {
      const options = id === 'date' ? DATE_OPTIONS : PRICE_OPTIONS;
      const current = id === 'date' ? value.dateFilter : value.price;
      return options.map(option => (
        <button
          key={option.value}
          type='button'
          className={optionRowClasses(option.value === current)}
          onClick={() => {
            onChange(
              id === 'date'
                ? { dateFilter: option.value as DateFilter }
                : { price: option.value as PriceFilter },
            );
            setOpenFilter(null);
          }}
        >
          <span className='flex-1'>{option.label}</span>
          {option.value === current && <Check className='size-3.5' />}
        </button>
      ));
    }

    if (id === 'distance') {
      return (
        <>
          <div className='grid grid-cols-5 gap-1'>
            {RADIUS_PRESETS.map(preset => (
              <button
                key={preset}
                type='button'
                aria-pressed={preset === value.radiusMiles}
                className={cn(
                  'rounded-md border py-1.5 text-xs transition-colors',
                  preset === value.radiusMiles
                    ? 'border-primary/40 bg-secondary font-medium'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                onClick={() => onChange({ radiusMiles: preset })}
              >
                {preset}
              </button>
            ))}
          </div>
          <form
            className='flex items-center gap-2'
            onSubmit={event => {
              event.preventDefault();
              commitRadiusDraft();
            }}
          >
            <Input
              type='number'
              min={1}
              max={500}
              inputMode='numeric'
              aria-label='Custom radius in miles'
              placeholder='Custom'
              value={radiusDraft}
              onChange={event => setRadiusDraft(event.target.value)}
              onBlur={commitRadiusDraft}
              className='h-8'
            />
            <span className='text-xs text-muted-foreground'>miles</span>
          </form>
          <p className='text-xs text-muted-foreground'>
            {resultCount} {resultCount === 1 ? 'event' : 'events'} match
          </p>
        </>
      );
    }

    return null;
  }

  const popoverWidths: Record<FilterId, string> = {
    date: 'w-52 p-1',
    distance: 'w-60 gap-3 p-3',
    price: 'w-44 p-1',
  };

  const hasAddableOptions = availableGames.length > 0 || availableFilters.length > 0;
  const hasActiveFilters = (showGames && value.games.length > 0) || active.length > 0;

  return (
    <div
      className={cn('flex w-full items-start justify-between gap-2', className)}
      aria-label='Filters'
    >
      <div className='flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        {hasAddableOptions && (
          <Popover open={addMenuOpen} onOpenChange={setAddMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                variant='outline'
                size='sm'
                className='h-7 shrink-0 rounded-2xl text-xs'
              >
                <ListFilter />
                Filter
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align='start'
              className='w-56 p-1 max-h-80 overflow-y-auto'
              onCloseAutoFocus={event => event.preventDefault()}
            >
              {availableGames.length > 0 && (
                <div className='space-y-0.5'>
                  <div className='px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
                    Games
                  </div>
                  {availableGames.map(game => (
                    <button
                      key={game}
                      type='button'
                      className={optionRowClasses(false)}
                      onClick={() => {
                        onChange({ games: [...value.games, game] });
                        setAddMenuOpen(false);
                      }}
                    >
                      <GameIcon
                        game={game}
                        className='size-4 shrink-0 object-contain'
                        decorative
                      />
                      <span className='flex-1 truncate'>{catalog.label(game)}</span>
                    </button>
                  ))}
                </div>
              )}

              {availableGames.length > 0 && availableFilters.length > 0 && (
                <div className='my-1 border-t border-border' />
              )}

              {availableFilters.length > 0 && (
                <div className='space-y-0.5'>
                  {availableGames.length > 0 && (
                    <div className='px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'>
                      Filters
                    </div>
                  )}
                  {availableFilters.map(id => {
                    const definition = FILTERS[id];
                    const Icon = definition.icon;
                    return (
                      <button
                        key={id}
                        type='button'
                        className={optionRowClasses(false)}
                        onClick={() => addFilter(id)}
                      >
                        <Icon className='size-3.5 text-muted-foreground' />
                        <span className='flex-1'>{definition.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}

        {showGames && value.games.map(game => (
          <FilterChip key={game}>
            <FilterChipValue
              className='gap-1.5 pl-2 pr-1 font-medium hover:bg-transparent cursor-default'
              tabIndex={-1}
            >
              <GameIcon
                game={game}
                className='size-3.5 shrink-0 object-contain'
                decorative
              />
              <span>{catalog.label(game)}</span>
            </FilterChipValue>
            <FilterChipRemove
              label={`Remove ${catalog.label(game)} filter`}
              onClick={() => {
                onChange({
                  games: value.games.filter(g => g !== game),
                });
              }}
            />
          </FilterChip>
        ))}

        {active.map(id => {
          const definition = FILTERS[id];
          const Icon = definition.icon;
          return (
            <FilterChip key={id}>
              <FilterChipSubject>
                <Icon />
                {definition.label}
              </FilterChipSubject>
              <Popover
                open={openFilter === id}
                onOpenChange={open => setOpenFilter(open ? id : null)}
              >
                <PopoverTrigger asChild>
                  <FilterChipOperator>{operators[id]}</FilterChipOperator>
                </PopoverTrigger>
                <PopoverTrigger asChild>
                  <FilterChipValue>{summaries[id]}</FilterChipValue>
                </PopoverTrigger>
                <PopoverContent align='start' className={popoverWidths[id]}>
                  {renderPopoverBody(id)}
                </PopoverContent>
              </Popover>
              <FilterChipRemove
                label={`Remove ${definition.label.toLowerCase()} filter`}
                onClick={() => removeFilter(id)}
              />
            </FilterChip>
          );
        })}
      </div>

      {hasActiveFilters && (
        <Button
          variant='destructive'
          size='sm'
          className='h-7 shrink-0 px-2 text-xs'
          onClick={clearAll}
        >
          <FilterX />
          <span className='hidden sm:block'>Clear</span>
        </Button>
      )}
    </div>
  );
}
