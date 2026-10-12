from playwright.sync_api import sync_playwright
W='<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none"><div style="transform:rotate(-20deg);font:900 64px Arial;color:rgba(200,0,0,.13);letter-spacing:6px">FICTIONAL SAMPLE · DEMO ONLY</div></div>'
base='<html><body style="margin:0;background:#ddd"><div id="d" style="position:relative;width:1100px;padding:50px 60px;background:{bg};font-family:Arial;color:#1d1d1d">{body}'+W+'</div></body></html>'
row=lambda k,v:f'<div style="font-size:30px;margin:14px 0"><b>{k}:</b> {v}</div>'
docs={
'sample_rccm_kin_market.png':('#f7f3e8','<div style="font-size:24px;letter-spacing:3px;color:#555">DEMOCRATIC REPUBLIC OF THE CONGO — SAMPLE</div><div style="font-size:40px;font-weight:900;margin:10px 0 30px">TRADE REGISTER (RCCM) CERTIFICATE</div>'+row('RCCM','CD/KIN/RCCM/26-B-12354')+row('ID NAT','01-83-N54321K')+row('Legal name','KIN MARKET SARL')+row('Legal form','SARL')+row('Activity','Retail of mobile phones and accessories')+row('Registered address','45, Avenue du Commerce')+row('Commune','Gombe')+row('City','Kinshasa')+row('Date of registration','14/03/2026')),
'sample_id_jean_paul_mukendi.png':('#e9f1f7','<div style="font-size:24px;letter-spacing:3px;color:#555">SAMPLE — NOT A REAL DOCUMENT</div><div style="font-size:40px;font-weight:900;margin:10px 0 30px">NATIONAL IDENTITY CARD</div>'+row('Surname','MUKENDI KABAMBA')+row('Given names','JEAN-PAUL')+row('ID No','CD0451872290')+row('Date of birth','12/05/1988')+row('Expiry date','20/11/2026')+row('Issuing authority','Sample Identification Office')),
'sample_id_renewed.png':('#e9f1f7','<div style="font-size:24px;letter-spacing:3px;color:#555">SAMPLE — NOT A REAL DOCUMENT</div><div style="font-size:40px;font-weight:900;margin:10px 0 30px">NATIONAL IDENTITY CARD</div>'+row('Surname','MUKENDI KABAMBA')+row('Given names','JEAN-PAUL')+row('ID No','CD0451872290')+row('Date of birth','12/05/1988')+row('Expiry date','20/11/2031')+row('Issuing authority','Sample Identification Office')),
'sample_proof_of_address.png':('#f1f7ee','<div style="font-size:24px;letter-spacing:3px;color:#555">KINSHASA UTILITIES (FICTIONAL)</div><div style="font-size:40px;font-weight:900;margin:10px 0 30px">PROOF OF ADDRESS — UTILITY BILL</div>'+row('Account holder','KIN MARKET SARL')+row('Service address','45, Avenue du Commerce')+row('Commune','Gombe')+row('City','Kinshasa')+row('Bill date','01/09/2026')+row('Amount due','42.00 USD')),
}
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1300,'height':900})
    for fn,(bg,body) in docs.items():
        pg.set_content(base.replace('{bg}',bg).replace('{body}',body)); pg.locator('#d').screenshot(path=fn)
    b.close()
