# 카페24 배포 스크립트
# 사용법:  powershell -ExecutionPolicy Bypass -File .\deploy-cafe24.ps1
#
# 하는 일
#  1. 지금 커밋된 코드(HEAD)를 임시 폴더에 꺼냅니다.
#  2. .env.cafe24 를 그 안에 .env 로 넣고 배포용 커밋을 하나 만듭니다.
#  3. 카페24 git 저장소의 master 로 푸시합니다. (카페24 저장소는 배포 전용이라 덮어씁니다)
# 내 작업 기록(main 브랜치)에는 .env 가 들어가지 않습니다.

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path '.env.cafe24')) {
  Write-Host '.env.cafe24 파일이 없습니다. .env.cafe24.example 을 복사해서 값을 채워 주세요.' -ForegroundColor Red
  exit 1
}

$envText = Get-Content '.env.cafe24' -Raw -Encoding UTF8
$m = [regex]::Match($envText, '(?m)^\s*CAFE24_GIT_URL\s*=\s*(\S+)\s*$')
if (-not $m.Success) {
  Write-Host '.env.cafe24 에 CAFE24_GIT_URL 을 적어 주세요.' -ForegroundColor Red
  exit 1
}
$gitUrl = $m.Groups[1].Value
foreach ($key in 'DB_USER', 'DB_PASSWORD', 'DB_NAME') {
  if ($envText -notmatch "(?m)^\s*$key\s*=\s*\S+") {
    Write-Host ".env.cafe24 에 $key 값이 비어 있습니다." -ForegroundColor Red
    exit 1
  }
}

$dirty = git status --porcelain
if ($dirty) {
  Write-Host '커밋하지 않은 변경이 있습니다. 먼저 커밋한 뒤 배포해 주세요:' -ForegroundColor Yellow
  $dirty
  exit 1
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("jinmi-deploy-" + [guid]::NewGuid().ToString('N'))
git worktree add --detach $tmp HEAD | Out-Null
try {
  # CAFE24_GIT_URL 줄은 서버에 올리지 않음
  $serverEnv = ($envText -split "`r?`n" | Where-Object { $_ -notmatch '^\s*CAFE24_GIT_URL\s*=' }) -join "`n"
  [System.IO.File]::WriteAllText((Join-Path $tmp '.env'), $serverEnv, (New-Object System.Text.UTF8Encoding $false))
  git -C $tmp add -f .env
  git -C $tmp commit -q -m "deploy $(git rev-parse --short HEAD) $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  Write-Host "카페24로 푸시합니다: $gitUrl" -ForegroundColor Cyan
  git -C $tmp push --force $gitUrl HEAD:master
  if ($LASTEXITCODE -ne 0) { throw 'git push 실패' }
  Write-Host '배포 완료. 카페24 관리 화면에서 앱을 (재)시작해 주세요.' -ForegroundColor Green
}
finally {
  git worktree remove --force $tmp
}
