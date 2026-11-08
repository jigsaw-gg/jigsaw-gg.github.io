import type { Locale } from './locale.ts'

type Gender = 'm' | 'f' | 'n'

type FlatNicknames = {
  gendered: false
  adjectives: readonly string[]
  nouns: readonly string[]
}

type GenderedAdjective = { m: string; f: string; n?: string }

type GenderedNicknames = {
  gendered: true
  adjectives: readonly GenderedAdjective[]
  nouns: readonly { word: string; gender: Gender }[]
}

const en: FlatNicknames = {
  gendered: false,
  adjectives: [
    'picky',
    'breezy',
    'sleepy',
    'wiggly',
    'sparkly',
    'mellow',
    'zippy',
    'clumsy',
    'cozy',
    'nifty',
    'jumpy',
    'sneaky',
    'rosy',
    'crispy',
    'bouncy',
    'dizzy',
    'fuzzy',
    'jaunty',
    'lucky',
    'merry',
    'peppy',
    'quirky',
    'sunny',
    'tidy',
    'wobbly',
    'zesty',
    'cheeky',
    'jolly',
    'gentle',
  ],
  nouns: [
    'cucumber',
    'panda',
    'kettle',
    'muffin',
    'pebble',
    'turnip',
    'waffle',
    'badger',
    'comet',
    'donut',
    'fern',
    'goose',
    'hedgehog',
    'igloo',
    'jelly',
    'kiwi',
    'lantern',
    'noodle',
    'otter',
    'pickle',
    'quokka',
    'radish',
    'sprout',
    'teacup',
    'walnut',
    'yacht',
    'zebra',
    'biscuit',
    'cactus',
  ],
}

const es: GenderedNicknames = {
  gendered: true,
  adjectives: [
    { m: 'quisquilloso', f: 'quisquillosa' },
    { m: 'airoso', f: 'airosa' },
    { m: 'soñoliento', f: 'soñolienta' },
    { m: 'inquieto', f: 'inquieta' },
    { m: 'brillante', f: 'brillante' },
    { m: 'sereno', f: 'serena' },
    { m: 'veloz', f: 'veloz' },
    { m: 'torpe', f: 'torpe' },
    { m: 'acogedor', f: 'acogedora' },
    { m: 'hábil', f: 'hábil' },
    { m: 'saltarín', f: 'saltarina' },
    { m: 'sigiloso', f: 'sigilosa' },
    { m: 'rosado', f: 'rosada' },
    { m: 'crujiente', f: 'crujiente' },
    { m: 'retozón', f: 'retozona' },
    { m: 'mareado', f: 'mareada' },
    { m: 'peludo', f: 'peluda' },
    { m: 'garboso', f: 'garbosa' },
    { m: 'afortunado', f: 'afortunada' },
    { m: 'alegre', f: 'alegre' },
    { m: 'vivaz', f: 'vivaz' },
    { m: 'peculiar', f: 'peculiar' },
    { m: 'soleado', f: 'soleada' },
    { m: 'pulcro', f: 'pulcra' },
    { m: 'tambaleante', f: 'tambaleante' },
    { m: 'picante', f: 'picante' },
    { m: 'pícaro', f: 'pícara' },
    { m: 'jovial', f: 'jovial' },
    { m: 'suave', f: 'suave' },
  ],
  nouns: [
    { word: 'pepino', gender: 'm' },
    { word: 'panda', gender: 'm' },
    { word: 'tetera', gender: 'f' },
    { word: 'magdalena', gender: 'f' },
    { word: 'guijarro', gender: 'm' },
    { word: 'nabo', gender: 'm' },
    { word: 'gofre', gender: 'm' },
    { word: 'tejón', gender: 'm' },
    { word: 'cometa', gender: 'm' },
    { word: 'rosquilla', gender: 'f' },
    { word: 'helecho', gender: 'm' },
    { word: 'ganso', gender: 'm' },
    { word: 'erizo', gender: 'm' },
    { word: 'iglú', gender: 'm' },
    { word: 'gelatina', gender: 'f' },
    { word: 'kiwi', gender: 'm' },
    { word: 'farol', gender: 'm' },
    { word: 'fideo', gender: 'm' },
    { word: 'nutria', gender: 'f' },
    { word: 'pepinillo', gender: 'm' },
    { word: 'quokka', gender: 'm' },
    { word: 'rábano', gender: 'm' },
    { word: 'brote', gender: 'm' },
    { word: 'taza', gender: 'f' },
    { word: 'nuez', gender: 'f' },
    { word: 'yate', gender: 'm' },
    { word: 'cebra', gender: 'f' },
    { word: 'galleta', gender: 'f' },
    { word: 'cactus', gender: 'm' },
  ],
}

const ru: GenderedNicknames = {
  gendered: true,
  adjectives: [
    { m: 'привередливый', f: 'привередливая', n: 'привередливое' },
    { m: 'ветреный', f: 'ветреная', n: 'ветреное' },
    { m: 'сонный', f: 'сонная', n: 'сонное' },
    { m: 'юркий', f: 'юркая', n: 'юркое' },
    { m: 'блестящий', f: 'блестящая', n: 'блестящее' },
    { m: 'мягкий', f: 'мягкая', n: 'мягкое' },
    { m: 'шустрый', f: 'шустрая', n: 'шустрое' },
    { m: 'неуклюжий', f: 'неуклюжая', n: 'неуклюжее' },
    { m: 'уютный', f: 'уютная', n: 'уютное' },
    { m: 'ловкий', f: 'ловкая', n: 'ловкое' },
    { m: 'прыгучий', f: 'прыгучая', n: 'прыгучее' },
    { m: 'хитрый', f: 'хитрая', n: 'хитрое' },
    { m: 'розовый', f: 'розовая', n: 'розовое' },
    { m: 'хрустящий', f: 'хрустящая', n: 'хрустящее' },
    { m: 'упругий', f: 'упругая', n: 'упругое' },
    { m: 'шальной', f: 'шальная', n: 'шальное' },
    { m: 'пушистый', f: 'пушистая', n: 'пушистое' },
    { m: 'бойкий', f: 'бойкая', n: 'бойкое' },
    { m: 'везучий', f: 'везучая', n: 'везучее' },
    { m: 'весёлый', f: 'весёлая', n: 'весёлое' },
    { m: 'бодрый', f: 'бодрая', n: 'бодрое' },
    { m: 'чудной', f: 'чудная', n: 'чудное' },
    { m: 'солнечный', f: 'солнечная', n: 'солнечное' },
    { m: 'аккуратный', f: 'аккуратная', n: 'аккуратное' },
    { m: 'шаткий', f: 'шаткая', n: 'шаткое' },
    { m: 'пряный', f: 'пряная', n: 'пряное' },
    { m: 'озорной', f: 'озорная', n: 'озорное' },
    { m: 'радостный', f: 'радостная', n: 'радостное' },
    { m: 'ласковый', f: 'ласковая', n: 'ласковое' },
  ],
  nouns: [
    { word: 'огурец', gender: 'm' },
    { word: 'панда', gender: 'f' },
    { word: 'чайник', gender: 'm' },
    { word: 'кекс', gender: 'm' },
    { word: 'камешек', gender: 'm' },
    { word: 'репка', gender: 'f' },
    { word: 'вафля', gender: 'f' },
    { word: 'барсук', gender: 'm' },
    { word: 'комета', gender: 'f' },
    { word: 'пончик', gender: 'm' },
    { word: 'папоротник', gender: 'm' },
    { word: 'гусь', gender: 'm' },
    { word: 'ёжик', gender: 'm' },
    { word: 'иглу', gender: 'n' },
    { word: 'желе', gender: 'n' },
    { word: 'киви', gender: 'm' },
    { word: 'фонарь', gender: 'm' },
    { word: 'лапша', gender: 'f' },
    { word: 'выдра', gender: 'f' },
    { word: 'корнишон', gender: 'm' },
    { word: 'квокка', gender: 'f' },
    { word: 'редиска', gender: 'f' },
    { word: 'росток', gender: 'm' },
    { word: 'чашка', gender: 'f' },
    { word: 'орех', gender: 'm' },
    { word: 'яхта', gender: 'f' },
    { word: 'зебра', gender: 'f' },
    { word: 'печенье', gender: 'n' },
    { word: 'кактус', gender: 'm' },
  ],
}

const NICKNAMES: Record<Locale, FlatNicknames | GenderedNicknames> = {
  en,
  es,
  ru,
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function adjectiveFor(adjective: GenderedAdjective, gender: Gender): string {
  if (gender === 'n') return adjective.n ?? adjective.m
  return adjective[gender]
}

/** One adjective and one noun from the lists for this locale, joined by a hyphen. */
export function nicknameFor(locale: Locale): string {
  const catalog = NICKNAMES[locale]
  if (!catalog.gendered) {
    return `${pick(catalog.adjectives)}-${pick(catalog.nouns)}`
  }
  const noun = pick(catalog.nouns)
  return `${adjectiveFor(pick(catalog.adjectives), noun.gender)}-${noun.word}`
}
