# Generates build/icon.ico (multi-resolution) and build/icon-256.png preview.
# Pure GDI+, no external tools. Design: vivid violet->pink->amber gradient
# rounded square with a white play triangle + slide progress dots.
Add-Type -AssemblyName System.Drawing

$sizes = @(256, 128, 64, 48, 32, 16)
$pngs = @{}

function New-RoundedRectPath {
    param($x, $y, $w, $h, $r)
    $d = $r * 2
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

foreach ($S in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($S, $S, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $r = 0.224 * $S
    $rect = New-Object System.Drawing.RectangleF(0, 0, $S, $S)
    $bgPath = New-RoundedRectPath 0 0 $S $S $r

    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::Black, [System.Drawing.Color]::White, 55)
    $blend = New-Object System.Drawing.Drawing2D.ColorBlend(3)
    $blend.Colors = @(
        [System.Drawing.Color]::FromArgb(124, 58, 237),
        [System.Drawing.Color]::FromArgb(236, 72, 153),
        [System.Drawing.Color]::FromArgb(245, 158, 11)
    )
    $blend.Positions = @(0.0, 0.55, 1.0)
    $brush.InterpolationColors = $blend
    $g.FillPath($brush, $bgPath)

    # soft top highlight
    $hiRect = New-Object System.Drawing.RectangleF(0, 0, $S, $S * 0.55)
    $hiBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($hiRect, [System.Drawing.Color]::FromArgb(70, 255, 255, 255), [System.Drawing.Color]::FromArgb(0, 255, 255, 255), 90)
    $hiPath = New-RoundedRectPath 0 0 $S ($S * 0.55) $r
    $g.FillPath($hiBrush, $hiPath)

    # play triangle
    $cx = 0.5 * $S; $cy = 0.45 * $S
    $w = 0.30 * $S; $h = 0.34 * $S
    $p1 = New-Object System.Drawing.PointF(($cx - $w * 0.42), ($cy - $h * 0.5))
    $p2 = New-Object System.Drawing.PointF(($cx - $w * 0.42), ($cy + $h * 0.5))
    $p3 = New-Object System.Drawing.PointF(($cx + $w * 0.58), $cy)

    $sh = 0.022 * $S
    $shadow = @(
        (New-Object System.Drawing.PointF($p1.X, ($p1.Y + $sh))),
        (New-Object System.Drawing.PointF($p2.X, ($p2.Y + $sh))),
        (New-Object System.Drawing.PointF($p3.X, ($p3.Y + $sh)))
    )
    $g.FillPolygon((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(55, 0, 0, 0))), $shadow)
    $g.FillPolygon((New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)), @($p1, $p2, $p3))

    # slide progress dots
    $dotY = 0.785 * $S
    $dr = 0.034 * $S
    $gap = 0.115 * $S
    foreach ($i in -1..1) {
        $dx = $cx + $i * $gap
        if ($i -eq 0) {
            $db = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
            $rr = $dr * 1.15
        }
        else {
            $db = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 255, 255, 255))
            $rr = $dr
        }
        $g.FillEllipse($db, ($dx - $rr), ($dotY - $rr), ($rr * 2), ($rr * 2))
    }

    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngs[$S] = $ms.ToArray()
    $bmp.Dispose()
}

[System.IO.File]::WriteAllBytes("$PSScriptRoot\icon-256.png", $pngs[256])

# Assemble multi-resolution .ico (PNG-compressed entries)
$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
foreach ($S in $sizes) {
    $data = $pngs[$S]
    $dim = if ($S -ge 256) { 0 } else { $S }
    $bw.Write([Byte]$dim)
    $bw.Write([Byte]$dim)
    $bw.Write([Byte]0)
    $bw.Write([Byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$data.Length)
    $bw.Write([UInt32]$offset)
    $offset += $data.Length
}
foreach ($S in $sizes) { $bw.Write($pngs[$S]) }
$bw.Flush()
[System.IO.File]::WriteAllBytes("$PSScriptRoot\icon.ico", $out.ToArray())
$bw.Dispose()
Write-Host "Wrote build/icon.ico and build/icon-256.png"
