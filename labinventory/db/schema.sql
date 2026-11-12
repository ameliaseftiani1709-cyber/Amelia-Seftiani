-- =====================================================================
-- LabInventory — skema database (Supabase / PostgreSQL)
-- Jalankan SEKALI di Supabase → SQL Editor, lalu jalankan db/seed.sql.
-- =====================================================================

-- ---------- Tabel ----------
create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  username      text not null unique check (username = lower(username) and char_length(username) between 3 and 30),
  password_hash text not null,                      -- scrypt (bukan plaintext)
  name          text not null,
  role          text not null check (role in ('ADMIN', 'STAFF')),
  active        boolean not null default true,      -- Admin dapat mengaktifkan/menonaktifkan Staff
  created_at    timestamptz not null default now()
);

create table if not exists items (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,                  -- contoh: BR001
  name       text not null,
  category   text not null,
  stock      integer not null check (stock >= 0),   -- total unit yang dimiliki lab
  created_at timestamptz not null default now()
);

create sequence if not exists trx_seq;

create table if not exists transactions (
  id          text primary key default ('TRX-' || lpad(nextval('trx_seq')::text, 4, '0')),
  item_id     uuid references items(id) on delete set null,   -- riwayat tetap ada bila barang dihapus
  item_code   text not null,                                  -- salinan kode & nama saat transaksi
  item_name   text not null,
  borrower    text not null,
  qty         integer not null check (qty > 0),
  borrow_date date not null,
  return_date date,
  status      text not null default 'Dipinjam' check (status in ('Dipinjam', 'Selesai')),
  created_by  uuid references users(id) on delete set null,
  returned_by uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  returned_at timestamptz
);

create index if not exists idx_trx_status     on transactions(status);
create index if not exists idx_trx_item       on transactions(item_id);
create index if not exists idx_trx_created_by on transactions(created_by);
create index if not exists idx_trx_created_at on transactions(created_at desc);

-- ---------- Fungsi atomik (mencegah stok minus saat dua transaksi bersamaan) ----------
create or replace function borrow_item(
  p_item uuid, p_borrower text, p_qty integer, p_date date, p_user uuid
) returns transactions
language plpgsql as $$
declare
  it      items%rowtype;
  out_qty integer;
  t       transactions%rowtype;
begin
  select * into it from items where id = p_item for update;   -- kunci baris barang
  if not found then
    raise exception 'Barang tidak ditemukan.';
  end if;

  select coalesce(sum(qty), 0) into out_qty
    from transactions where item_id = p_item and status = 'Dipinjam';

  if p_qty > it.stock - out_qty then
    raise exception 'Stok tersedia hanya % unit.', it.stock - out_qty;
  end if;

  insert into transactions (item_id, item_code, item_name, borrower, qty, borrow_date, created_by)
  values (it.id, it.code, it.name, p_borrower, p_qty, p_date, p_user)
  returning * into t;
  return t;
end $$;

create or replace function return_item(p_trx text, p_user uuid)
returns transactions
language plpgsql as $$
declare
  t transactions%rowtype;
begin
  update transactions
     set status = 'Selesai',
         return_date = (now() at time zone 'Asia/Jakarta')::date,
         returned_by = p_user,
         returned_at = now()
   where id = p_trx and status = 'Dipinjam'
  returning * into t;

  if not found then
    if exists (select 1 from transactions where id = p_trx) then
      raise exception 'Transaksi sudah selesai.';
    else
      raise exception 'Transaksi tidak ditemukan.';
    end if;
  end if;
  return t;
end $$;

-- ---------- Keamanan ----------
-- Hanya backend (service_role key) yang boleh mengakses data.
-- RLS aktif tanpa policy + hak akses anon/authenticated dicabut,
-- sehingga anon key yang terlihat di browser tidak bisa membaca apa pun.
alter table users        enable row level security;
alter table items        enable row level security;
alter table transactions enable row level security;

revoke all on users, items, transactions from anon, authenticated;
revoke all on sequence trx_seq from anon, authenticated;
revoke all on function borrow_item(uuid, text, integer, date, uuid) from public, anon, authenticated;
revoke all on function return_item(text, uuid) from public, anon, authenticated;
