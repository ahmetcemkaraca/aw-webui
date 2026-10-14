import { applyTheme } from '~/util/theme';
afterEach(()=>document.querySelectorAll('link[data-peak-theme],link[href="/dark.css"]').forEach(link=>link.remove()));
test('read-only theme application replaces old dark links and removes dark CSS for light',()=>{
 applyTheme('dark');applyTheme('dark');expect(document.querySelectorAll('link[href="/dark.css"]')).toHaveLength(1);applyTheme('light');expect(document.querySelector('link[href="/dark.css"]')).toBeNull();
});
test('authoritative auto theme applies the actual system preference without settings writes',()=>{
 const original=window.matchMedia;window.matchMedia=jest.fn(()=>({matches:true}));applyTheme('auto');expect(document.querySelector('link[data-peak-theme]')).not.toBeNull();window.matchMedia=jest.fn(()=>({matches:false}));applyTheme('auto');expect(document.querySelector('link[data-peak-theme]')).toBeNull();window.matchMedia=original;
});
