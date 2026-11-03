# 울산대 숨길 · 배포 가이드

울산대 캠퍼스 담배연기 실시간 신고 지도예요. 빌드 과정 없는 정적 사이트라서 파일을 그대로 올리면 돼요. 서버는 Supabase(무료)를 써요.

| 파일 | 역할 |
|---|---|
| `index.html` | 앱 전체 (지도, 3D 앞마당, 아바타) |
| `adapter.js` | Supabase 연결부. 접속자 위치는 Realtime Presence, 신고는 `reports` 테이블 |
| `config.js` | **여기에 Supabase 주소랑 키만 넣으면 돼요** |
| `schema.sql` | Supabase에 한 번 실행할 DB 설정 |
| `og.png`, `favicon.svg` | 카톡·인스타 공유 미리보기, 탭 아이콘 |

## 1. Supabase 만들기 (5분)
1. https://supabase.com → **Start your project** → GitHub로 로그인
2. **New project** → 이름 `uou-sumgil`, Region은 **Northeast Asia (Seoul)**, DB 비밀번호는 아무거나 길게 (어디 적어두기)
3. 생성되면 왼쪽 메뉴 **SQL Editor** → `schema.sql` 내용 전체 붙여넣기 → **Run** → `Success` 뜨면 끝
4. **Project Settings → API**에서 두 개 복사
   - `Project URL` → `config.js`의 `supabaseUrl`
   - `anon` `public` 키 → `config.js`의 `supabaseAnonKey`
   - ⚠️ `service_role` 키는 절대 넣지 마세요 (DB 전체 권한 키예요)

## 2. Vercel에 올리기 (5분)
1. https://github.com → 새 저장소 `uou-sumgil` (Public이어도 괜찮아요. anon 키는 공개용이에요)
2. 저장소 화면 **Add file → Upload files** → 이 폴더 파일 전부 끌어다 놓기 → **Commit**
3. https://vercel.com → GitHub로 로그인 → **Add New → Project** → `uou-sumgil` **Import**
4. Framework Preset은 **Other**, 설정 건드리지 말고 **Deploy**
5. 1분 뒤 `https://uou-sumgil.vercel.app` 같은 주소가 나와요. 이게 배포 링크예요

> 나중에 수정할 땐 GitHub에 파일만 다시 올리면 Vercel이 자동으로 새로 배포해요.

## 3. 배포 후 체크리스트
- [ ] 폰 2대(또는 폰 + 노트북)로 열어서 오른쪽 위에 **"지금 2명 접속 중"**이 뜨는지
- [ ] 한쪽에서 **"얘들아 여기 연기!"** 누르면 다른 쪽에 빨간 알림이 뜨는지
- [ ] 같은 건물에 둘 다 들어가서 뿅망치가 상대 화면에도 보이는지
- [ ] 카톡 미리보기: `index.html`의 `og:image`를 `https://내주소.vercel.app/og.png`처럼 **전체 주소**로 바꾸기 (카톡은 상대 경로를 못 읽어요)

## 무료 한도 (Supabase Free)
- 동시 접속 **200명**, 실시간 메시지 월 **200만 건**까지
- 시험기간에 한꺼번에 몰리면 200명 제한에 걸릴 수 있어요. 넘으면 새로 들어온 사람은 혼자 보기 모드로 열려요 (지도는 그대로 돼요)
- 일주일 동안 접속이 없으면 프로젝트가 일시정지돼요 → Supabase 대시보드에서 **Restore** 누르면 돼요

## 운영할 때 알아둘 것
- **도배 방지**: 캠퍼스 전체에서 1분에 60건이 넘으면 신고가 막혀요 (`schema.sql`의 `reports_guard`). 브라우저당 15초 쿨타임도 있어요
- **닉네임·말풍선은 필터가 없어요.** 욕설이 문제 되면 말해줘요. 금칙어 필터를 붙일게요
- **개인정보**: 실제 GPS는 안 써요. 지도 속 아바타 위치랑 닉네임만 접속자끼리 공유되고, DB에는 신고 위치·종류·시간만 저장돼요
- **오래된 신고 정리**: 화면에는 10분만 보이고 DB에서도 30분 뒤엔 안 읽혀요. 하루 지난 신고를 아예 지우려면 `schema.sql` 맨 아래 주석을 참고하세요
- 지도 데이터는 © OpenStreetMap 기여자 (ODbL). 화면 아래 출처 표시는 지우면 안 돼요
