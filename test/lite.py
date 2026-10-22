import asyncio, os, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(); errs = []
        pg = await b.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: errs.append(f'PAGEERROR: {e}'))
        await pg.goto('file://' + os.path.join(ROOT, 'dist', 'SubGrid-Lite.html')); await pg.wait_for_timeout(1500)
        print('edition', await pg.inner_text('#brand-ed'), '| fonts', await pg.evaluate("document.fonts.check('12px \"Share Tech Mono\"') && document.fonts.check('700 12px \"Exo 2\"')"))
        await pg.keyboard.press('w'); await pg.wait_for_timeout(200)
        print('after W: tool', await pg.evaluate('window.__subgrid.S.tool'), '| toast', (await pg.inner_text('#toasts')).split('\n')[-1])
        await pg.click('[data-left="zones"]'); await pg.wait_for_timeout(200)
        print('locks', await pg.locator('.lockbox').count())
        await pg.screenshot(path=os.path.join(ROOT, 'test', 'shots') + '/l1_zones.png')
        await pg.click('[data-left="live"]')
        await pg.click('#g-effort [data-v="thorough"]'); await pg.wait_for_timeout(100)
        print('effort', await pg.evaluate('window.__subgrid.S.goal.effort'))
        await pg.click('#lv-run'); await pg.wait_for_timeout(7000)
        print('phase:', await pg.inner_text('#lv-phase'))
        print('cards', await pg.locator('#lv-results .res').count(), '| skips:', (await pg.inner_text('#lv-results .skips')).replace('\n', ' ')[:200] if await pg.locator('#lv-results .skips').count() else '-')
        await pg.screenshot(path=os.path.join(ROOT, 'test', 'shots') + '/l2_opt.png')
        await pg.click('#lv-run')
        # mobile-ish width
        await pg.set_viewport_size({'width': 390, 'height': 800}); await pg.wait_for_timeout(500)
        print('h-scroll', await pg.evaluate('document.documentElement.scrollWidth > innerWidth'))
        print('\n'.join(errs) or 'no console errors')
        await b.close()
asyncio.run(main())
