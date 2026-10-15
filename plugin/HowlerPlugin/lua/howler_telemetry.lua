-- Howler: telemetría extra del coche del jugador (EXPERIMENTAL).
-- Lo reparte el propio servidor (CSP lo descarga solo; el jugador no instala nada) y manda al servidor, unas 5 veces por
-- segundo, lo que el servidor no recibe por sí mismo: pedal de freno real, aceleración y datos de las ruedas.
-- Los nombres de los campos de ac.StateCar no están verificados: al empezar se prueban varios candidatos y se apuntan en
-- el log de CSP (Documents\Assetto Corsa\logs\custom_shaders_patch.log, líneas «[Howler]») cuáles existen y cuánto valen.

local SEND_EVERY = 0.2 -- segundos (el servidor original admite un mensaje cada 200 ms)

local function get(obj, name)
  local ok, v = pcall(function() return obj[name] end)
  if not ok then return nil end
  return v
end

local function num(v)
  if type(v) == 'number' then return v end
  if type(v) == 'boolean' then return v and 1 or 0 end
  return nil
end

local function vec(v)
  if v == nil then return nil end
  local x, y, z = get(v, 'x'), get(v, 'y'), get(v, 'z')
  if type(x) == 'number' and type(y) == 'number' and type(z) == 'number' then return { x, y, z } end
  return nil
end

local CAR_NUMBERS = { 'gas', 'brake', 'clutch', 'handbrake', 'steer', 'gear', 'rpm', 'speedKmh', 'absInAction', 'tractionControlInAction',
  'absMode', 'tcMode', 'brakeBias', 'fuel', 'turboBoost', 'wheelsOutside', 'isInPit' }
local CAR_VECTORS = { 'acceleration', 'accelerationG', 'localVelocity', 'velocity', 'localAngularVelocity', 'angularVelocity' }
local WHEEL_NUMBERS = { 'slipRatio', 'slipAngle', 'ndSlip', 'load', 'tyrePressure', 'tyreCoreTemperature', 'tyreInsideTemperature',
  'tyreMiddleTemperature', 'tyreOutsideTemperature', 'discTemperature', 'angularSpeed', 'rotationSpeed', 'tyreRadius', 'tyreVirtualKM',
  'suspensionTravel', 'damage' }

local event = ac.OnlineEvent({
  ac.StructItem.key('howlerTel'),
  brake = ac.StructItem.float(), gas = ac.StructItem.float(), clutch = ac.StructItem.float(), steer = ac.StructItem.float(),
  speed = ac.StructItem.float(),
  ax = ac.StructItem.float(), ay = ac.StructItem.float(), az = ac.StructItem.float(),
  slip0 = ac.StructItem.float(), slip1 = ac.StructItem.float(), slip2 = ac.StructItem.float(), slip3 = ac.StructItem.float(),
  load0 = ac.StructItem.float(), load1 = ac.StructItem.float(), load2 = ac.StructItem.float(), load3 = ac.StructItem.float(),
  pres0 = ac.StructItem.float(), pres1 = ac.StructItem.float(), pres2 = ac.StructItem.float(), pres3 = ac.StructItem.float(),
  temp0 = ac.StructItem.float(), temp1 = ac.StructItem.float(), temp2 = ac.StructItem.float(), temp3 = ac.StructItem.float(),
  flags = ac.StructItem.int32(), -- bit 0 = ABS actuando, bit 1 = control de tracción actuando
}, function() end)

local found = {}   -- nombre -> true, lo que existe de verdad
local logged = false
local acc, logAcc = 0, 0

local function wheel(car, i)
  local ok, w = pcall(function() return car.wheels[i] end)
  if ok then return w end
  return nil
end

local function discover(car)
  local lines = {}
  for _, n in ipairs(CAR_NUMBERS) do
    local v = num(get(car, n))
    if v ~= nil then found['car.' .. n] = true; lines[#lines + 1] = string.format('car.%s = %s', n, tostring(v)) end
  end
  for _, n in ipairs(CAR_VECTORS) do
    local v = vec(get(car, n))
    if v then found['car.' .. n] = true; lines[#lines + 1] = string.format('car.%s = (%.3f, %.3f, %.3f)', n, v[1], v[2], v[3]) end
  end
  for i = 0, 3 do
    local w = wheel(car, i)
    if w then
      for _, n in ipairs(WHEEL_NUMBERS) do
        local v = num(get(w, n))
        if v ~= nil then found['wheel.' .. n] = true; lines[#lines + 1] = string.format('wheels[%d].%s = %s', i, n, tostring(v)) end
      end
    end
  end
  ac.log('[Howler] campos de ac.StateCar disponibles (' .. #lines .. '):')
  for _, l in ipairs(lines) do ac.log('[Howler]   ' .. l) end
  logged = true
end

local function first(w, names)
  for _, n in ipairs(names) do local v = num(get(w, n)); if v ~= nil then return v end end
  return 0
end

local function send(car)
  local a = vec(get(car, 'acceleration')) or vec(get(car, 'accelerationG')) or { 0, 0, 0 }
  local m = {
    brake = num(get(car, 'brake')) or 0, gas = num(get(car, 'gas')) or 0, clutch = num(get(car, 'clutch')) or 0,
    steer = num(get(car, 'steer')) or 0, speed = num(get(car, 'speedKmh')) or 0, ax = a[1], ay = a[2], az = a[3],
    flags = ((num(get(car, 'absInAction')) or 0) > 0 and 1 or 0) + ((num(get(car, 'tractionControlInAction')) or 0) > 0 and 2 or 0),
  }
  for i = 0, 3 do
    local w = wheel(car, i)
    if w then
      m['slip' .. i] = first(w, { 'slipRatio', 'ndSlip' })
      m['load' .. i] = first(w, { 'load' })
      m['pres' .. i] = first(w, { 'tyrePressure' })
      m['temp' .. i] = first(w, { 'tyreCoreTemperature', 'tyreMiddleTemperature' })
    end
  end
  event(m)
end

function script.update(dt)
  local car = ac.getCar(0)
  if car == nil then return end
  if not logged then discover(car) end
  acc = acc + dt
  logAcc = logAcc + dt
  if logAcc >= 5 then   -- una muestra en el log cada 5 s para poder comparar a mano
    logAcc = 0
    ac.log(string.format('[Howler] muestra: brake=%s gas=%s speed=%s', tostring(num(get(car, 'brake'))), tostring(num(get(car, 'gas'))), tostring(num(get(car, 'speedKmh')))))
  end
  if acc >= SEND_EVERY then
    acc = 0
    local ok, err = pcall(send, car)
    if not ok then ac.log('[Howler] error al enviar: ' .. tostring(err)) end
  end
end
