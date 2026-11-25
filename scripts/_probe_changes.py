import urllib.request,csv,io,collections as C
u="https://docs.google.com/spreadsheets/d/1EaE2karm7nAJ5YoNPuBQdWND1t5fSufRlnoyFukZt5g/export?format=csv&gid=0"
t=urllib.request.urlopen(u,timeout=60).read().decode("utf-8")
r=list(csv.DictReader(io.StringIO(t)))
print("HDR",list(r[0].keys()))
print("L1",C.Counter(x.get("custom_label_1","<no column>") for x in r))
