# Linux test server: cd app && go build -o sgtest .   (then python3 test/desktop.py)
import asyncio, json, os, subprocess, sys, glob, time, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
SCR = os.environ.get('SG_TEST_DIR', os.path.join(tempfile.gettempdir(), 'sgtest'))
for d in ['data', 'save']: os.makedirs(f'{SCR}/{d}', exist_ok=True)
for f in glob.glob(f'{SCR}/data/*') + glob.glob(f'{SCR}/save/*'):
    if os.path.isfile(f): os.remove(f)
env = dict(os.environ, SG_DATA_DIR=f'{SCR}/data', SG_SAVE_DIR=f'{SCR}/save', SG_OPEN_FILE=os.path.join(ROOT, 'test', 'import_grid.json'))
srv = subprocess.Popen([os.environ.get('SG_BIN', os.path.join(ROOT, 'app', 'sgtest'))], env=env, stdout=subprocess.PIPE, text=True)
URL = srv.stdout.readline().strip(); print('URL', URL[:40] + '…')
SHOTS = os.path.join(ROOT, 'test', 'shots'); os.makedirs(SHOTS, exist_ok=True)
async def w2s(pg, x, y):
    return await pg.evaluate("""([x,y]) => { const c=document.querySelector('#plan'), r=c.getBoundingClientRect(), v=window.__subgrid.S.view;
      return [r.left + r.width/2 + (x - v.x)*v.s, r.top + r.height/2 - (y - v.y)*v.s]; }""", [x, y])
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        pg = await b.new_page(viewport={'width': 1600, 'height': 1000})
        pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: errs.append(f'PAGEERROR: {e}'))
        # security: wrong token / host must 404
        import urllib.request
        base = URL.rsplit('/s/', 1)[0]
        try: urllib.request.urlopen(base + '/s/wrongtoken12345678/index.html'); print('!! wrong token served')
        except Exception as e: print('wrong token ->', getattr(e, 'code', e))
        await pg.goto(URL); await pg.wait_for_timeout(1800)
        print('edition', await pg.inner_text('#brand-ed'), '| title', await pg.title())
        print('log ready:', 'page ready' in open(f'{SCR}/data/subgrid.log').read())
        S = lambda expr: pg.evaluate('() => { const S = window.__subgrid.S; return ' + expr + '; }')
        # stage zone via key 2 + rect drag
        await pg.keyboard.press('2'); await pg.keyboard.press('r')
        a = await w2s(pg, -5, -1); c = await w2s(pg, 5, -6)
        await pg.mouse.move(*a); await pg.mouse.down(); await pg.mouse.move(*c, steps=6); await pg.mouse.up(); await pg.wait_for_timeout(200)
        print('kinds now', await S("S.shapes.map(z=>z.kind).join(',')"))
        # walls: W + 4 clicks + click on first point closes
        await pg.keyboard.press('w'); await pg.wait_for_timeout(100)
        pts = [(-14, -8), (14, -8), (14, 28), (-14, 28)]
        for x, y in pts:
            sx, sy = await w2s(pg, x, y); await pg.mouse.click(sx, sy); await pg.wait_for_timeout(80)
        sx, sy = await w2s(pg, *pts[0]); await pg.mouse.click(sx, sy); await pg.wait_for_timeout(300)
        print('walls', await S("JSON.stringify(S.walls.map(w=>[w.p.length/2, w.loss]))"), 'reflOrder', await S('S.settings.reflOrder'))
        await pg.keyboard.press('s'); await pg.wait_for_timeout(600)
        await pg.screenshot(path=f'{SHOTS}/d1_walls.png')
        # tooltip with reflections (hover)
        sx, sy = await w2s(pg, 3, 12); await pg.mouse.move(sx, sy); await pg.wait_for_timeout(300)
        print('tip', (await pg.inner_text('#tip')).replace('\n', ' | '))
        # measure
        await pg.keyboard.press('m'); a = await w2s(pg, 0, 0); c = await w2s(pg, 6, 20)
        await pg.mouse.move(*a); await pg.mouse.down(); await pg.mouse.move(*c, steps=5); await pg.mouse.up()
        print('measure', await S('JSON.stringify(S.measure)'))
        await pg.screenshot(path=f'{SHOTS}/d2_measure.png')
        await pg.keyboard.press('Escape'); await pg.keyboard.press('s')
        # zoom far out
        sx, sy = await w2s(pg, 0, 5)
        for i in range(40): await pg.mouse.move(sx, sy); await pg.mouse.wheel(0, 400); await pg.wait_for_timeout(15)
        await pg.wait_for_timeout(400)
        print('zoom s', await S('S.view.s'))
        await pg.screenshot(path=f'{SHOTS}/d3_zoomout.png')
        await pg.keyboard.press('0'); await pg.wait_for_timeout(300)
        # plan image: zones tab -> load -> calibrate
        await pg.click('[data-left="zones"]'); await pg.wait_for_timeout(200)
        async with pg.expect_file_chooser() as fc:
            await pg.click('#bg-load')
        ch = await fc.value; await ch.set_files(os.path.join(ROOT, 'test', 'plan_test.png')); await pg.wait_for_timeout(800)
        print('bg', await S("S.bg && [S.bg.w, S.bg.h, +S.bg.mpp.toFixed(4)].join(',')"), 'tool', await S('S.tool'))
        bg = await S('S.bg')
        # image px (100,100)-(1100,100) is a 1000 px line: call it 25 m
        x1, y1 = bg['x'] + 100 * bg['mpp'], bg['y'] - 100 * bg['mpp']; x2 = bg['x'] + 1100 * bg['mpp']
        for x in (x1, x2):
            sx, sy = await w2s(pg, x, y1); await pg.mouse.click(sx, sy); await pg.wait_for_timeout(150)
        await pg.fill('#cal-len', '25'); await pg.click('#cal-ok'); await pg.wait_for_timeout(300)
        print('calibrated mpp', await S('S.bg.mpp'), 'expect', 25 / 1000)
        await pg.keyboard.press('0'); await pg.wait_for_timeout(400)
        await pg.screenshot(path=f'{SHOTS}/d4_plan.png')
        # optimizer with walls + stage
        await pg.click('[data-left="live"]'); await pg.wait_for_timeout(200)
        await pg.click('#lv-run'); await pg.wait_for_timeout(9000)
        print('phase:', await pg.inner_text('#lv-phase'))
        await pg.click('#lv-proto-wrap summary'); await pg.wait_for_timeout(700)
        rows = await pg.locator('.proto-t tbody tr').count(); print('protocol rows', rows, '|', (await pg.inner_text('#lv-proto-n')))
        print('top result:', (await pg.inner_text('#lv-results .res.top .res-hd')).replace('\n', ' '))
        await pg.screenshot(path=f'{SHOTS}/d5_opt.png')
        await pg.click('#lv-run'); await pg.wait_for_timeout(300)
        # kpis
        print('kpis:', (await pg.inner_text('#kpis')).replace('\n', ' '))
        # save project
        await pg.keyboard.press('Control+s'); await pg.wait_for_timeout(800)
        files = os.listdir(f'{SCR}/save'); print('saved files', files)
        d = json.load(open(f'{SCR}/save/' + files[0]))
        print('saved: walls', len(d['walls']), 'stage zones', sum(1 for z in d['zones'] if z['kind'] == 'stage'), 'bg', bool(d['subgrid'].get('bg')))
        await pg.click('#b-file'); await pg.click('[data-act="subarray"]'); await pg.wait_for_timeout(600)
        sa = [f for f in os.listdir(f'{SCR}/save') if f.endswith('.json')]
        d2 = json.load(open(f'{SCR}/save/' + sa[0])); print('subarray export: kinds', sorted(set((z['kind'], z.get('sg_kind', '')) for z in d2['zones'])), 'bg' in d2['subgrid'])
        # reload -> persisted
        await pg.reload(); await pg.wait_for_timeout(1500)
        print('after reload walls', await S('S.walls.length'), 'bg', await S('!!S.bg'), 'stage', await S("S.shapes.filter(z=>z.kind==='stage').length"))
        # open (Subarray import)
        await pg.keyboard.press('Control+o'); await pg.wait_for_timeout(700)
        print('opened:', (await pg.inner_text('#toasts')).replace('\n', ' | ')[-140:])
        print('\n'.join(errs) or 'no console errors')
        await b.close()
    print('--- log tail'); print(''.join(open(f'{SCR}/data/subgrid.log').readlines()[-6:]))
    srv.terminate()
asyncio.run(main())
