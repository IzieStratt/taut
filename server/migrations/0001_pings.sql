create table pings (
  day text not null,
  install text not null,
  user text not null,
  team text not null,
  version text not null,
  loader text not null,
  loader_version text not null,
  embedded integer,
  os text,
  primary key (install, day)
);
create index pings_day on pings (day);
