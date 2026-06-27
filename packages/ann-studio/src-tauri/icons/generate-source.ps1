# Render the G-Maiden icon source from the Gem visual identity used in App.tsx.
# Pipes through `pnpm tauri icon <path>` afterwards to populate every platform size.
# Run from repo root: pwsh src-tauri/icons/generate-source.ps1
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$size = 1024
$bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::Transparent)

# Geometry: a 600x600 rounded square rotated 45 deg about the canvas center.
$gemSide = 600
$radius = [int]($gemSide * 0.27)  # matches the 0.27 borderRadius factor in App.tsx
$cx = $size / 2
$cy = $size / 2

function New-RoundedSquarePath([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x,          $y,          $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y,          $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d,   0, 90)
    $path.AddArc($x,          $y + $h - $d, $d, $d,  90, 90)
    $path.CloseFigure()
    return $path
}

# Rotate-about-center transform for everything we draw below.
$g.TranslateTransform([float]$cx, [float]$cy)
$g.RotateTransform(45)
$g.TranslateTransform(-[float]($gemSide / 2), -[float]($gemSide / 2))

$rect = New-Object System.Drawing.RectangleF(0, 0, [float]$gemSide, [float]$gemSide)
$mainPath = New-RoundedSquarePath 0 0 $gemSide $gemSide $radius

# Soft outer glow (cheap fake-blur — multiple expanding strokes at falling alpha).
$glowSteps = @(36, 28, 20, 12, 6)
foreach ($w in $glowSteps) {
    $alpha = [int](90 - $w * 1.8)
    if ($alpha -lt 8) { $alpha = 8 }
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb($alpha, 143, 212, 255)), $w
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawPath($pen, $mainPath)
    $pen.Dispose()
}

# Main fill: 135-deg linear gradient #8fd4ff -> #3f7fb0 (App.tsx Gem).
$top = [System.Drawing.Color]::FromArgb(255, 143, 212, 255)
$bot = [System.Drawing.Color]::FromArgb(255,  63, 127, 176)
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect, $top, $bot,
    [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
$g.FillPath($brush, $mainPath)
$brush.Dispose()

# Subtle inner highlight on the upper-left edge.
$hiPath = New-RoundedSquarePath 24 24 ($gemSide - 48) ($gemSide - 48) ([int]($radius * 0.85))
$hiPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 255, 255, 255)), 6
$g.DrawPath($hiPen, $hiPath)
$hiPen.Dispose()

$g.ResetTransform()
$g.Dispose()

$out = 'G:\G-Maiden\src-tauri\icons\icon-source.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "Wrote $out"
