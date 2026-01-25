import React from 'react';
import type { AppService } from '../types';

const APP_ICON_SLUG: Partial<Record<AppService, string>> = {
  '9gag': '9gag',
  amazon: 'amazon',
  bereal: 'bereal',
  blizzard: 'blizzard',
  chatgpt: 'chatgpt',
  dailymotion: 'dailymotion',
  discord: 'discord',
  disneyplus: 'disneyplus',
  ebay: 'ebay',
  facebook: 'facebook',
  fortnite: 'fortnite',
  'google-chat': 'googlechat',
  hbomax: 'hbomax',
  hulu: 'hulu',
  imgur: 'imgur',
  instagram: 'instagram',
  leagueoflegends: 'leagueoflegends',
  mastodon: 'mastodon',
  messenger: 'messenger',
  minecraft: 'minecraft',
  netflix: 'netflix',
  pinterest: 'pinterest',
  'playstation-network': 'playstation',
  primevideo: 'primevideo',
  reddit: 'reddit',
  roblox: 'roblox',
  signal: 'signal',
  skype: 'skype',
  snapchat: 'snapchat',
  spotify: 'spotify',
  steam: 'steam',
  telegram: 'telegram',
  tiktok: 'tiktok',
  tinder: 'tinder',
  tumblr: 'tumblr',
  twitch: 'twitch',
  twitter: 'x',
  vimeo: 'vimeo',
  vk: 'vk',
  whatsapp: 'whatsapp',
  xboxlive: 'xbox',
  youtube: 'youtube',
  zoom: 'zoom'
};

function fallbackLabel(label: string): string {
  const trimmed = (label || '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}

export function AppLogo({
  app,
  label,
  size = 16
}: {
  app: AppService;
  label: string;
  size?: number;
}): React.ReactElement {
  const slug = APP_ICON_SLUG[app];
  const [failed, setFailed] = React.useState(false);

  if (!slug || failed) {
    return (
      <span
        className="inline-flex items-center justify-center rounded bg-zinc-800 text-zinc-200 text-[10px] font-bold"
        style={{ width: size, height: size, lineHeight: `${size}px` }}
        aria-label={label}
        title={label}
      >
        {fallbackLabel(label)}
      </span>
    );
  }

  // Simple Icons CDN: monochrome SVG. We tint via CSS `color` when using currentColor.
  // The CDN supports hex colors; we keep it neutral and rely on UI color.
  const src = `https://cdn.simpleicons.org/${encodeURIComponent(slug)}/a1a1aa`;

  return (
    <img
      src={src}
      width={size}
      height={size}
      loading="lazy"
      alt=""
      aria-hidden="true"
      className="shrink-0"
      onError={() => setFailed(true)}
    />
  );
}
