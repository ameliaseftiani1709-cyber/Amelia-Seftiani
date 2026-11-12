-- =====================================================================
-- LabInventory - Skema database Supabase (PostgreSQL)
-- Cara pakai: Supabase Dashboard > SQL Editor > New query > tempel > Run.
-- Aman dijalankan ulang (idempotent).
--
-- Keamanan: tabel dikunci (RLS aktif, tanpa policy, hak akses dicabut).
-- Browser HANYA bisa memanggil fungsi di bawah. Setiap fungsi memeriksa
-- token sesi dan role di server. Password disimpan sebagai hash bcrypt.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tabel ----------
create table if not exists public.users (
  id serial primary key,
  nama text not null,
  username text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin','staff')),
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id serial primary key,
  kode text not null unique,
  nama text not null,
  kategori text not null,
  stok int not null check (stok >= 0),
  tersedia int not null check (tersedia >= 0),
  created_at timestamptz not null default now(),
  check (tersedia <= stok)
);

create table if not exists public.transactions (
  id serial primary key,
  peminjam text not null,
  item_id int references public.items(id) on delete set null,
  item_kode text not null,
  item_nama text not null,
  qty int not null check (qty > 0),
  tgl_pinjam date not null,
  tgl_kembali date,
  status text not null default 'Dipinjam' check (status in ('Dipinjam','Selesai')),
  catatan text not null default '',
  created_by int references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (tgl_kembali is null or tgl_kembali >= tgl_pinjam)
);

create table if not exists public.sessions (
  token text primary key,
  user_id int not null references public.users(id) on delete cascade,
  expires_at timestamptz not null
);

alter table public.users enable row level security;
alter table public.items enable row level security;
alter table public.transactions enable row level security;
alter table public.sessions enable row level security;
revoke all on public.users, public.items, public.transactions, public.sessions from anon, authenticated;

-- ---------- Data awal ----------
do $$
begin
  if not exists (select 1 from public.users) then
    insert into public.users (nama, username, password_hash, role, aktif) values
      ('Administrator Lab', 'admin',  extensions.crypt('admin123', extensions.gen_salt('bf')), 'admin', true),
      ('Staff Laboratorium','staff',  extensions.crypt('staff123', extensions.gen_salt('bf')), 'staff', true),
      ('Staff Cadangan',    'staff2', extensions.crypt('staff123', extensions.gen_salt('bf')), 'staff', false);
  end if;

  if not exists (select 1 from public.items) then
    insert into public.items (kode, nama, kategori, stok, tersedia) values
      ('BR001','Laptop Lenovo','Laptop',5,3),
      ('BR002','Mouse Logitech','Aksesori',10,7),
      ('BR003','Keyboard Mechanical','Aksesori',8,8),
      ('BR004','Proyektor Epson','Proyektor',3,3),
      ('BR005','Monitor LG','Monitor',6,6),
      ('BR006','Laptop ASUS VivoBook','Laptop',4,4),
      ('BR007','Monitor Dell 24 inci','Monitor',5,5),
      ('BR008','Router TP-Link','Jaringan',4,4),
      ('BR009','Switch Cisco 24 Port','Jaringan',2,2),
      ('BR010','Kabel LAN 10 m','Jaringan',20,20),
      ('BR011','Kabel HDMI','Kabel',12,12),
      ('BR012','Webcam Logitech C920','Aksesori',6,6),
      ('BR013','Headset Rexus','Aksesori',9,9),
      ('BR014','Stop Kontak Terminal','Kelistrikan',10,10),
      ('BR015','Access Point Ubiquiti','Jaringan',3,3),
      ('BR016','Flashdisk 64 GB','Penyimpanan',15,15);

    insert into public.transactions (peminjam,item_id,item_kode,item_nama,qty,tgl_pinjam,tgl_kembali,status,catatan,created_by)
    select 'Budi Santoso', i.id, i.kode, i.nama, 2, current_date-2, null, 'Dipinjam', 'Praktikum jaringan', (select id from public.users where username='staff')
      from public.items i where i.kode='BR001';
    insert into public.transactions (peminjam,item_id,item_kode,item_nama,qty,tgl_pinjam,tgl_kembali,status,catatan,created_by)
    select 'Siti Aminah', i.id, i.kode, i.nama, 3, current_date-1, null, 'Dipinjam', '', (select id from public.users where username='staff')
      from public.items i where i.kode='BR002';
    insert into public.transactions (peminjam,item_id,item_kode,item_nama,qty,tgl_pinjam,tgl_kembali,status,catatan,created_by)
    select 'Andi Pratama', i.id, i.kode, i.nama, 1, current_date-6, current_date-5, 'Selesai', '', (select id from public.users where username='admin')
      from public.items i where i.kode='BR003';
    insert into public.transactions (peminjam,item_id,item_kode,item_nama,qty,tgl_pinjam,tgl_kembali,status,catatan,created_by)
    select 'Dewi Lestari', i.id, i.kode, i.nama, 1, current_date-8, current_date-7, 'Selesai', 'Seminar prodi', (select id from public.users where username='staff')
      from public.items i where i.kode='BR004';
  end if;
end $$;

-- ---------- Fungsi internal: cek sesi dan role ----------
create or replace function public._auth(p_token text, p_role text default null)
returns public.users
language plpgsql security definer set search_path = public, extensions as $$
declare u public.users;
begin
  select us.* into u from public.sessions s join public.users us on us.id = s.user_id
   where s.token = p_token and s.expires_at > now();
  if not found or not u.aktif then
    raise exception 'Sesi berakhir. Silakan masuk lagi.';
  end if;
  if p_role is not null and u.role <> p_role then
    raise exception 'Akses ditolak. Fitur ini hanya untuk %.', initcap(p_role);
  end if;
  return u;
end $$;

-- ---------- Autentikasi ----------
create or replace function public.login(p_username text, p_password text)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare u public.users; t text;
begin
  select * into u from public.users where lower(username) = lower(trim(coalesce(p_username,'')));
  if not found or u.password_hash <> crypt(coalesce(p_password,''), u.password_hash) then
    raise exception 'Username atau password salah. Periksa lagi lalu coba masuk.';
  end if;
  if not u.aktif then
    raise exception 'Akun ini nonaktif. Hubungi Admin untuk mengaktifkannya.';
  end if;
  delete from public.sessions where expires_at < now();
  t := encode(gen_random_bytes(32), 'hex');
  insert into public.sessions (token, user_id, expires_at) values (t, u.id, now() + interval '7 days');
  return json_build_object('token', t,
    'user', json_build_object('id', u.id, 'nama', u.nama, 'username', u.username, 'role', u.role));
end $$;

create or replace function public.logout(p_token text)
returns void
language sql security definer set search_path = public, extensions as $$
  delete from public.sessions where token = p_token;
$$;

-- ---------- Membaca data (satu panggilan untuk semua halaman) ----------
create or replace function public.get_data(p_token text)
returns json
language plpgsql security definer set search_path = public, extensions as $$
declare u public.users;
begin
  u := public._auth(p_token);
  return json_build_object(
    'me', json_build_object('id', u.id, 'nama', u.nama, 'username', u.username, 'role', u.role),
    'items', coalesce((select json_agg(json_build_object('id', i.id, 'kode', i.kode, 'nama', i.nama,
              'kategori', i.kategori, 'stok', i.stok, 'tersedia', i.tersedia) order by i.kode) from public.items i), '[]'::json),
    'tx', coalesce((select json_agg(json_build_object('id', t.id, 'peminjam', t.peminjam, 'itemId', t.item_id,
              'itemNama', t.item_nama, 'qty', t.qty, 'tglPinjam', t.tgl_pinjam, 'tglKembali', t.tgl_kembali,
              'status', t.status, 'oleh', coalesce(c.username, '-'), 'catatan', t.catatan) order by t.id desc)
              from public.transactions t left join public.users c on c.id = t.created_by), '[]'::json),
    'users', case when u.role = 'admin' then
              coalesce((select json_agg(json_build_object('id', x.id, 'nama', x.nama, 'username', x.username,
                'role', x.role, 'aktif', x.aktif) order by x.id) from public.users x), '[]'::json)
             else '[]'::json end
  );
end $$;

-- ---------- Barang (Admin) ----------
create or replace function public.item_save(p_token text, p_id int, p_kode text, p_nama text, p_kategori text, p_stok int)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare k text; v_out int;
begin
  perform public._auth(p_token, 'admin');
  k := upper(trim(coalesce(p_kode,'')));
  if k = '' or trim(coalesce(p_nama,'')) = '' or trim(coalesce(p_kategori,'')) = '' then
    raise exception 'Kode, nama, dan kategori wajib diisi.';
  end if;
  if p_stok is null or p_stok < 0 then
    raise exception 'Stok harus berupa angka 0 atau lebih.';
  end if;
  if exists (select 1 from public.items where kode = k and id is distinct from p_id) then
    raise exception 'Kode % sudah dipakai. Gunakan kode lain.', k;
  end if;
  if p_id is null then
    insert into public.items (kode, nama, kategori, stok, tersedia) values (k, trim(p_nama), trim(p_kategori), p_stok, p_stok);
  else
    select stok - tersedia into v_out from public.items where id = p_id for update;
    if not found then raise exception 'Barang tidak ditemukan.'; end if;
    if p_stok < v_out then
      raise exception 'Stok tidak boleh kurang dari %, jumlah yang sedang dipinjam.', v_out;
    end if;
    update public.items set kode = k, nama = trim(p_nama), kategori = trim(p_kategori),
           stok = p_stok, tersedia = p_stok - v_out where id = p_id;
  end if;
end $$;

create or replace function public.item_delete(p_token text, p_id int)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._auth(p_token, 'admin');
  if exists (select 1 from public.transactions where item_id = p_id and status = 'Dipinjam') then
    raise exception 'Barang masih dipinjam. Selesaikan pengembaliannya dulu.';
  end if;
  delete from public.items where id = p_id;
end $$;

-- ---------- Peminjaman dan pengembalian (Admin dan Staff) ----------
create or replace function public.borrow_create(p_token text, p_peminjam text, p_item_id int, p_qty int, p_tgl date, p_catatan text default '')
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare u public.users; it public.items;
begin
  u := public._auth(p_token);
  if trim(coalesce(p_peminjam,'')) = '' then raise exception 'Nama peminjam wajib diisi.'; end if;
  if p_qty is null or p_qty < 1 then raise exception 'Jumlah minimal 1.'; end if;
  if p_tgl is null then raise exception 'Tanggal peminjaman wajib diisi.'; end if;
  select * into it from public.items where id = p_item_id for update;
  if not found then raise exception 'Barang tidak ditemukan.'; end if;
  if p_qty > it.tersedia then
    raise exception 'Stok % tersisa %. Kurangi jumlah peminjaman.', it.nama, it.tersedia;
  end if;
  update public.items set tersedia = tersedia - p_qty where id = it.id;
  insert into public.transactions (peminjam, item_id, item_kode, item_nama, qty, tgl_pinjam, catatan, created_by)
  values (trim(p_peminjam), it.id, it.kode, it.nama, p_qty, p_tgl, trim(coalesce(p_catatan,'')), u.id);
end $$;

create or replace function public.borrow_return(p_token text, p_tx_id int, p_tgl date)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare t public.transactions;
begin
  perform public._auth(p_token);
  select * into t from public.transactions where id = p_tx_id for update;
  if not found then raise exception 'Transaksi tidak ditemukan.'; end if;
  if t.status = 'Selesai' then raise exception 'Transaksi ini sudah dikembalikan.'; end if;
  if p_tgl is null or p_tgl < t.tgl_pinjam then
    raise exception 'Tanggal pengembalian tidak boleh sebelum tanggal peminjaman.';
  end if;
  update public.transactions set status = 'Selesai', tgl_kembali = p_tgl where id = t.id;
  if t.item_id is not null then
    update public.items set tersedia = tersedia + t.qty where id = t.item_id;
  end if;
end $$;

-- ---------- Pengguna (Admin) ----------
create or replace function public.user_save(p_token text, p_id int, p_nama text, p_username text, p_password text default null)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare un text;
begin
  perform public._auth(p_token, 'admin');
  un := lower(trim(coalesce(p_username,'')));
  if trim(coalesce(p_nama,'')) = '' then raise exception 'Nama lengkap wajib diisi.'; end if;
  if un !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username 3-20 karakter: huruf, angka, atau garis bawah.';
  end if;
  if exists (select 1 from public.users where username = un and id is distinct from p_id) then
    raise exception 'Username % sudah dipakai. Pilih yang lain.', un;
  end if;
  if p_id is null then
    if length(coalesce(p_password,'')) < 6 then raise exception 'Password minimal 6 karakter.'; end if;
    insert into public.users (nama, username, password_hash, role)
    values (trim(p_nama), un, crypt(p_password, gen_salt('bf')), 'staff');
  else
    perform 1 from public.users where id = p_id and role = 'staff';
    if not found then raise exception 'Hanya akun Staff yang bisa diubah.'; end if;
    update public.users set nama = trim(p_nama), username = un where id = p_id;
    if coalesce(p_password,'') <> '' then
      if length(p_password) < 6 then raise exception 'Password minimal 6 karakter.'; end if;
      update public.users set password_hash = crypt(p_password, gen_salt('bf')) where id = p_id;
    end if;
  end if;
end $$;

create or replace function public.user_toggle(p_token text, p_id int)
returns void
language plpgsql security definer set search_path = public, extensions as $$
declare a boolean;
begin
  perform public._auth(p_token, 'admin');
  update public.users set aktif = not aktif where id = p_id and role = 'staff' returning aktif into a;
  if not found then raise exception 'Hanya akun Staff yang bisa diaktifkan atau dinonaktifkan.'; end if;
  if not a then delete from public.sessions where user_id = p_id; end if;
end $$;

-- ---------- Hak akses: browser hanya boleh memanggil fungsi publik ----------
revoke execute on function public._auth(text, text) from public, anon, authenticated;
grant execute on function
  public.login(text, text),
  public.logout(text),
  public.get_data(text),
  public.item_save(text, int, text, text, text, int),
  public.item_delete(text, int),
  public.borrow_create(text, text, int, int, date, text),
  public.borrow_return(text, int, date),
  public.user_save(text, int, text, text, text),
  public.user_toggle(text, int)
to anon, authenticated;
