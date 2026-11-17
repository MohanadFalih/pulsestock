import urllib.request,csv,io
u="https://docs.google.com/spreadsheets/d/1EaE2karm7nAJ5YoNPuBQdWND1t5fSufRlnoyFukZt5g/export?format=csv&gid=0"
try:
    r=urllib.request.urlopen(u,timeout=30); t=r.read().decode('utf-8'); rows=list(csv.reader(io.StringIO(t)))
    print("OK rows",len(rows), rows[0][:8]); print(rows[1][:7])
except Exception as e: print("FAIL",e)
