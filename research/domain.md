# The domain: devinesflowersandbotanicals.com

Inventory taken 2026-10-14, before the name servers moved to Vercel.
Everything below was read from the live zone (dig from Kevin's Mac) and
from the screenshot Lee Younkman (Creative Web Designing, "CWD Network")
emailed of his DNS panel. Kept here so the flip can be checked, and
reversed, from a written record rather than memory.

## Who holds what

- Registrar: GoDaddy, in Kevin's account (customer # 106575291,
  hershock@protonmail.com). Lee transferred it there; nothing else came
  with it.
- DNS before the flip: Lee's servers, `ns1.cwdnetwork.com` and
  `ns2.cwdnetwork.com`. GoDaddy's DNS tab shows no records for exactly
  this reason ("DNS is currently managed elsewhere").
- DNS after the flip: Vercel, `ns1.vercel-dns.com` and
  `ns2.vercel-dns.com`. The domain (apex and www, www redirecting 308
  to the apex) is already attached to the Vercel project; Vercel serves
  the site records itself once it holds the zone. It refuses to create
  any record before then (`invalid_zone`), so the records below go in
  right after the switch, not before.
- Email: nobody uses the domain's mailboxes. Katy reads
  devinesflowersandbotanicals@gmail.com, and the shop's order tickets go
  there (ORDER_TO). The mail records are carried over so nothing that
  works today stops working, not because anyone depends on them.

## Records carried over to Vercel

| Type  | Name                | Value |
| ----- | ------------------- | ----- |
| MX    | @                   | 10 `mx10.antispam.mailspamprotection.com.` |
| MX    | @                   | 20 `mx20.antispam.mailspamprotection.com.` |
| MX    | @                   | 30 `mx30.antispam.mailspamprotection.com.` |
| TXT   | @                   | `v=spf1 +a +mx +ip4:35.208.68.9 include:devinesflowersandbotanicals.com.spf.auto.dnssmarthost.net ~all` |
| TXT   | @                   | `google-site-verification=xE_71DeEN-gc4vVWUzlGGWZrsmMReLdGCnoraGcbQi0` |
| TXT   | `_dmarc`            | `v=DMARC1; p=none; aspf=r; adkim=r;` |
| CNAME | `default._domainkey`| `devinesflowersandbotanicals.com.default.dkim.auto.dnssmarthost.net.` |
| A     | `mail`              | `35.208.68.9` |

## Records NOT carried over, and why

- A `@` and A `www` ("CDN Record" in Lee's panel): the old website.
  Replaced by Vercel's own records for ours.
- A `ssh`, `ftp`, `autoconfig`, `autodiscover` -> 35.208.68.9: hosting
  conveniences for Lee's server (shell and file access, mail-client
  autodiscovery for mailboxes nobody uses). Nothing of Katy's points at
  them. Left out on purpose; any one can be added in a minute if a need
  turns up.

## The flip, step by step

1. GoDaddy -> the domain -> DNS -> Nameservers -> Change Nameservers ->
   "I'll use my own nameservers" -> the two Vercel names above -> Save.
2. Poll Vercel (`get_domain`) until the zone is active, then create the
   eight records in the table.
3. Verify from outside: apex and www resolve to the site; MX, SPF,
   DMARC and the DKIM alias read back as listed.
4. Leave Lee's zone untouched. It is no longer consulted once the name
   servers change, and an intact copy makes a rollback one setting.

Caches expire within minutes to a few hours; the old site and the new
one can both be seen from different networks during that window.
