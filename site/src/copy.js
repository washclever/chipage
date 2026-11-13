// Every word on the page, in both languages. Square brackets mark what the company still has to supply.
// The page introduces the company to investors and to other founders. So each line says one thing that happens, in words
// such a reader already knows (design, simulation, layout, foundry), and names the technical term once where it is the
// exact word (PDK, GDS). No word that could mean several things, and nothing about how the software is delivered.
// The stations follow the film (film.js, STATIONS): the chip, the input, the schematic, the candidates, the layout,
// its candidates, the build, the whole process, the status, and last the company, before its forge.
export const COPY = {
  ko: {
    brand: '[회사 이름]', deck: '회사 소개서', demo: '데모', scroll: '스크롤', other: 'EN',
    loading: '불러오는 중', warn: '광과민성 발작 주의 · 이 페이지에는 밝게 번쩍이는 빛과 빠르게 움직이는 장면이 있습니다.',
    nav: ['회사', '입력', '회로도', '검증', '레이아웃', '배치', '제조', '전 과정', '현황', '소개'],
    s: [
      { k: '01 — 회사', h: '반도체 칩 설계 자동화', p: '아날로그 회로의 설계, 시뮬레이션 검증, 레이아웃 생성을 소프트웨어가 수행합니다.' },
      { k: '02 — 입력', h: '사양을 입력하면 회로도가 나옵니다.', p: '입력 한 줄이 트랜지스터 단위의 회로도로 바뀝니다.' },
      { k: '03 — 회로도', h: '회로 설계와 시뮬레이션이 자동 루프를 돕니다.', p: '회로를 그리면 바로 시뮬레이션하고, 그 결과로 회로를 고칩니다.', n: '6T SRAM · 64비트 (8 × 8)' },
      { k: '04 — 검증', h: '후보 회로를 동시에 시뮬레이션합니다.', p: '결과를 수치로 비교해 성능이 가장 높은 회로 하나를 고릅니다.' },
      { k: '05 — 레이아웃', h: '회로도가 제조용 레이아웃이 됩니다.', p: '파운드리 공정 규칙(PDK)에 맞춘 도면 파일(GDS)을 층별로 생성합니다.' },
      { k: '06 — 배치', h: '레이아웃도 여러 안을 만들어 고릅니다.', p: '같은 회로를 다르게 배치하고, 비교해서 하나를 남깁니다.' },
      { k: '07 — 제조', h: 'GDS는 파운드리 제조에 바로 쓰입니다.', p: '웨이퍼 위에 금속 층을 쌓고 깎는 공정이 이 도면대로 진행됩니다.' },
      { k: '08 — 전 과정', h: '사양 입력부터 제조용 도면까지 자동화합니다.', p: '회로 생성, 시뮬레이션, 후보 비교, 레이아웃 생성이 하나의 과정으로 이어집니다.' },
      { k: '09 — 현황', h: '개발 현황', list: [['데모', '브라우저에서 회로도를 그리고 바로 SPICE로 시뮬레이션합니다. 과도, DC, AC, 잡음 해석과 측정, SKY130 공정 모델.'], ['AI', 'AI 도우미가 회로를 그리고, 배선하고, 시뮬레이션합니다.'], ['레이아웃', '예제 회로를 SKY130 규칙으로 자동 배치·배선하고, DRC/LVS로 검사해 GDS로 내려받습니다.'], ['목표', '사양 한 줄에서 회로 설계, 시뮬레이션 검증, 후보 비교, 제조용 GDS까지 사람 손 없이 이어지는 것.']], p: '데모는 설치 없이 브라우저에서 바로 열립니다.' },
      { k: '10 — 소개', h: '[회사 이름]', p: '[회사를 한두 문장으로: 누구이고, 왜 이 일을 하는지]', list: [['설립', '[연도 · 도시]'], ['팀', '[사람들과 그 배경]'], ['연락', '[이메일]']] },
    ],
    order: 'make 64-bit memory!', best: '선택', layers: '레이아웃 층',
    layerNames: ['active', 'poly', 'contact · via', 'metal 1', 'metal 2', 'metal 3', 'MIM', 'top metal'],
    blocks: { cells: '비트 셀 8 × 8', dec: '행 디코더', pre: '프리차지', io: '쓰기 · 감지 증폭기', ctl: '제어', pads: '패드' },
  },
  en: {
    brand: '[Company]', deck: 'Company deck', demo: 'Demo', scroll: 'Scroll', other: '한국어',
    loading: 'Loading', warn: 'Photosensitive seizure warning · This page contains bright flashing light and fast-moving scenes.',
    nav: ['Company', 'Input', 'Schematic', 'Verification', 'Layout', 'Placement', 'Fabrication', 'End to end', 'Status', 'About'],
    s: [
      { k: '01 — Company', h: 'Semiconductor chip design automation', p: 'Software does the design, the simulation and the layout of analog circuits.' },
      { k: '02 — Input', h: 'Enter a specification. Get a schematic.', p: 'One line of input becomes a schematic, down to each transistor.' },
      { k: '03 — Schematic', h: 'Design and simulation run as an automatic loop.', p: 'A circuit is simulated as soon as it is drawn, and revised from the result.', n: '6T SRAM · 64 bits (8 × 8)' },
      { k: '04 — Verification', h: 'Candidate circuits are simulated at the same time.', p: 'The results are compared as numbers, and the best-performing circuit is kept.' },
      { k: '05 — Layout', h: 'The schematic becomes a layout for manufacturing.', p: 'A GDS file is generated layer by layer, to the foundry’s process rules (PDK).' },
      { k: '06 — Placement', h: 'Layouts are generated in several versions, too.', p: 'The same circuit is placed in different ways, compared, and one is kept.' },
      { k: '07 — Fabrication', h: 'The GDS goes straight to the foundry.', p: 'Metal is deposited and etched on the wafer, layer by layer, as the file says.' },
      { k: '08 — End to end', h: 'From specification to manufacturing file, automated.', p: 'Circuit generation, simulation, comparison of candidates and layout generation run as one process.' },
      { k: '09 — Status', h: 'Status', list: [['Demo', 'Draw a schematic in the browser and simulate it with SPICE at once: transient, DC, AC and noise analyses and measurements, on SKY130 process models.'], ['AI', 'An assistant that draws, wires and simulates the circuit.'], ['Layout', 'Example circuits placed and routed to SKY130 rules automatically, checked by DRC/LVS and downloaded as GDS.'], ['Goal', 'From a one-line specification to circuit design, verification by simulation, the choice among candidates and a GDS ready for the foundry, with no hand in between.']], p: 'The demo opens in the browser, with nothing to install.' },
      { k: '10 — About', h: '[Company]', p: '[The company in a sentence or two: who you are, and why you do this]', list: [['Founded', '[Year · city]'], ['Team', '[The people, and their background]'], ['Contact', '[Email]']] },
    ],
    order: 'make 64-bit memory!', best: 'best', layers: 'Layout layers',
    layerNames: ['active', 'poly', 'contact · via', 'metal 1', 'metal 2', 'metal 3', 'MIM', 'top metal'],
    blocks: { cells: 'bit cells 8 × 8', dec: 'row decoder', pre: 'precharge', io: 'write · sense amplifier', ctl: 'control', pads: 'pads' },
  },
};
