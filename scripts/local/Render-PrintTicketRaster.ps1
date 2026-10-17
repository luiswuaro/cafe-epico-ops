#requires -Version 5.1
# Renderiza Unicode a 384 px bit-packed para puente ESC/POS 1.3.
# JSON entra por STDIN; solo JSON sale por STDOUT. Windows GDI+.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$payload=[Console]::In.ReadToEnd() | ConvertFrom-Json
if($null -eq $payload -or @($payload.lines).Count -lt 1 -or
   @($payload.lines).Count -gt 240){throw 'Cantidad de lineas fuera de rango'}
$width=384
$maxHeight=5000
$margin=17
$bmp=New-Object System.Drawing.Bitmap($width,$maxHeight)
$graphics=[System.Drawing.Graphics]::FromImage($bmp)
$graphics.Clear([System.Drawing.Color]::White)
$graphics.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$brush=[System.Drawing.Brushes]::Black
$normal=New-Object System.Drawing.Font('Arial',19,[System.Drawing.FontStyle]::Regular,[System.Drawing.GraphicsUnit]::Pixel)
$bold=New-Object System.Drawing.Font('Arial',21,[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
$big=New-Object System.Drawing.Font('Arial',31,[System.Drawing.FontStyle]::Bold,[System.Drawing.GraphicsUnit]::Pixel)
$y=9
try {
  $logoProperty=$payload.PSObject.Properties['logo']
  if($null -ne $logoProperty -and $null -ne $logoProperty.Value){
    $logo=$logoProperty.Value
    $lw=[int]$logo.width;$lh=[int]$logo.height
    if($lw -ge 1 -and $lw -le 384 -and $lh -ge 1 -and $lh -le 800){
      $bytes=[Convert]::FromBase64String([string]$logo.dataBase64)
      $stride=[int][Math]::Ceiling($lw/8.0)
      if($bytes.Length -ne $stride*$lh){throw 'Logo bitmap incorrecto'}
      $left=$margin
      if($logo.align -eq 'center'){$left=[int][Math]::Floor(($width-$lw)/2)}
      if($logo.align -eq 'right'){$left=$width-$margin-$lw}
      for($r=0;$r -lt $lh;$r++){
        for($col=0;$col -lt $lw;$col++){
          $ix=$r*$stride+[int][Math]::Floor($col/8)
          if(($bytes[$ix] -band (128 -shr ($col%8))) -ne 0){
            $bmp.SetPixel($left+$col,$y+$r,[System.Drawing.Color]::Black)
          }
        }
      }
      $y+=$lh+12
    }
  }
  foreach($line in @($payload.lines)){
    $message=[string]$line.text
    if($message.Length -gt 460){throw 'Linea demasiado larga'}
    $font=$normal
    if($line.bold -eq $true){$font=$bold}
    if($line.size -eq 'double'){$font=$big}
    $lineHeight=([int][Math]::Ceiling($font.GetHeight($graphics)))+5
    $alignment=[string]$line.align
    $words=@($message -split '\s+' | Where-Object {$_ -ne ''})
    $rows=New-Object System.Collections.Generic.List[string]
    $current=''
    foreach($word in $words){
      $candidate=if($current){$current+' '+$word}else{$word}
      if($graphics.MeasureString($candidate,$font).Width -le $width-2*$margin){
        $current=$candidate;continue
      }
      if($current){$rows.Add($current);$current=''}
      if($graphics.MeasureString($word,$font).Width -le $width-2*$margin){
        $current=$word;continue
      }
      $part=''
      foreach($char in $word.ToCharArray()){
        $next=$part+[string]$char
        if($part -and $graphics.MeasureString($next,$font).Width -gt $width-2*$margin){
          $rows.Add($part);$part=[string]$char
        }else{$part=$next}
      }
      $current=$part
    }
    if($current){$rows.Add($current)}
    if($rows.Count -eq 0){$rows.Add(' ')}
    foreach($row in $rows){
      if($y+$lineHeight+28 -ge $maxHeight){throw 'Ticket excede 5000 px'}
      $w=$graphics.MeasureString($row,$font).Width
      $x=$margin
      if($alignment -eq 'center'){$x=($width-$w)/2}
      if($alignment -eq 'right'){$x=$width-$margin-$w}
      $graphics.DrawString($row,$font,$brush,[float]$x,[float]$y)
      $y+=$lineHeight
    }
  }
  $y+=22
  if($y -lt 40){throw 'Raster incompleto'}
  $height=[int][Math]::Ceiling($y)
  $stride=48
  $packed=New-Object byte[] ($stride*$height)
  for($r=0;$r -lt $height;$r++){
    for($col=0;$col -lt $width;$col++){
      $color=$bmp.GetPixel($col,$r)
      $lum=0.2126*$color.R+0.7152*$color.G+0.0722*$color.B
      if($lum -lt 190){
        $ix=$r*$stride+[int][Math]::Floor($col/8)
        $packed[$ix]=[byte]($packed[$ix] -bor (128 -shr ($col%8)))
      }
    }
  }
  $result=@{
    raster=@{dataBase64=[Convert]::ToBase64String($packed);
      width=$width;height=$height;align='center'}
    feed=[int][Math]::Max(1,[Math]::Min(8,[int]$payload.feed))
    cut=($payload.cut -eq $true)
  }
  [Console]::Out.Write(($result | ConvertTo-Json -Compress -Depth 5))
} finally {
  $normal.Dispose()
  $bold.Dispose()
  $big.Dispose()
  $graphics.Dispose()
  $bmp.Dispose()
}
