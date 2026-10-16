"""Build the fixed hub-and-spoke park, preserving the working coaster tracks."""
import collections
import copy
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILE = ROOT / 'public/parks/showcase.json'
park = json.loads(FILE.read_text())
old = copy.deepcopy(park['grid'])
info = (ROOT / 'src/games/coaster/types/game.ts').read_text()
sizes = {name: (int(w), int(h)) for name, w, h in re.findall(
    r"^  (\w+): \{[^\n]*size: \{ width: (\d+), height: (\d+) \}", info, re.M)}
valid = set(re.findall(r'^  (\w+): \{ name:', info, re.M))
valid.update(re.findall(r"name: '(\w+)'", (ROOT / 'src/games/coaster/lib/coasterRenderConfig.ts').read_text()))
base = copy.deepcopy(old[0][0]['building'])
base.update(type='empty', operating=False)
size = park['gridSize']
grid = [[dict(x=x, y=y, terrain='grass', building=copy.deepcopy(base), path=False,
              queue=False, queueRideId=None, hasCoasterTrack=False, coasterTrackId=None,
              trackPiece=None, elevation=0) for x in range(size)] for y in range(size)]
# The source park contains five records for the same coaster. Keep its final record.
coasters = {}
for coaster in park['coasters']:
    signature = tuple(sorted(set((t['x'], t['y']) for t in coaster['trackTiles'])))
    coasters[signature] = coaster
park['coasters'] = list(coasters.values())
for index, coaster in enumerate(park['coasters']):
    for pos in coaster['trackTiles']:
        x, y = pos['x'], pos['y']
        grid[y][x] = copy.deepcopy(old[y][x])
        grid[y][x].update(terrain='grass', building=copy.deepcopy(base), path=False,
                          queue=False, queueRideId=None, coasterTrackId=coaster['id'])
    coaster.update(operating=True, broken=False)
    for train in coaster['trains']:
        for car in train['cars']:
            car['guests'] = []


def empty(x, y):
    return 0 <= x < size and 0 <= y < size and grid[y][x]['building']['type'] == 'empty'


def place(kind, x, y, track=False):
    assert kind in valid, kind
    w, h = sizes.get(kind, (1, 1))
    assert all((empty(x+dx, y+dy) or (kind == 'park_entrance' and grid[y+dy][x+dx]['path'])) and (track or not grid[y+dy][x+dx]['hasCoasterTrack'])
               for dy in range(h) for dx in range(w)), (kind, x, y)
    for dy in range(h):
        for dx in range(w):
            tile = grid[y+dy][x+dx]
            tile.update(path=kind == 'park_entrance', queue=False)
            tile['building'] = {**base, 'type': kind if dx == dy == 0 else kind + '_footprint',
                                'operating': kind.startswith(('ride_', 'show_', 'station_')),
                                'capacity': 24, 'cycleTime': 160}


def road(x, y, queue=False, ride=None):
    if not empty(x, y):
        return False
    tile = grid[y][x]
    tile.update(path=not queue, queue=queue, queueRideId=ride)
    tile['building'] = {**base, 'type': 'queue' if queue else 'path'}
    return True


def avenue(x1, y1, x2, y2, width=2):
    for x in range(min(x1, x2), max(x1, x2)+1):
        for y in range(min(y1, y2), max(y1, y2)+1):
            for d in range(width):
                road(x+d if x1 == x2 else x, y+d if y1 == y2 else y)


# Working coaster stations, with queue entrances on the same connected network.
stations = [(12, 15, 'station_wooden_1'), (19, 27, 'station_steel_1'), (15, 9, 'station_wooden_2')]
for coaster, (x, y, kind) in zip(park['coasters'], stations):
    # Source track geometry may use the alternate final anchor on regenerated builds.
    if not any(t['x'] == x and t['y'] == y for t in coaster['trackTiles']):
        x, y = coaster['stationTileX'], coaster['stationTileY']
    place(kind, x, y, track=True)
    coaster.update(stationTileX=x, stationTileY=y)

# Main Street, central square, and promenades linking the themed areas.
avenue(29, 36, 29, 59, 3)
for a in [(24,24,36,24),(24,35,36,35),(24,24,24,35),(35,24,35,35),
          (7,32,24,32),(35,30,54,30),(33,6,33,24),
          (9,35,24,35),(9,51,24,51),(9,35,9,51),(23,35,23,51),
          (38,9,54,9),(38,27,54,27),(38,9,38,30),(53,9,53,30),
          (38,36,54,36),(38,53,54,53),(38,30,38,53),(53,30,53,53),
          (24,47,38,47),(7,6,33,6),(7,6,7,32)]:
    avenue(*a)
avenue(8, 11, 33, 11, 1)  # Northern midway between the two coaster entrances.

# Castle court and central fountain: separate landmarks with open space around them.
place('ride_themed_facade', 28, 27)
place('fountain_large_1', 30, 32)
# Fantasy gardens, Tomorrow district, Adventure waterfront.
placements = [
    ('ride_carousel',12,38),('ride_ferris_led',17,43),('food_icecream',13,47),
    ('food_cotton_candy',20,39),('shop_plush',20,48),('drink_lemonade',11,44),
    ('ride_go_karts',41,12),('ride_simulator',48,20),('arcade_building',43,23),
    ('food_fries',49,12),('drink_soda',49,24),('shop_rc',41,19),
    ('show_parade_float',41,39),('ride_sky_swing',47,44),('food_kebab',41,49),
    ('drink_smoothie',49,50),('shop_photo',49,39),('food_hotdog',40,33),
    ('shop_souvenir_1',26,40),('shop_candy',33,40),('food_churros',26,45),
    ('shop_toys',33,45),('food_pretzel',26,50),('shop_souvenir_2',33,50),
    ('restroom',25,55),('first_aid',34,55),('park_entrance',29,56),
    ('food_burger',15,31),('drink_soda',11,31),('restroom',21,31),
    ('restroom',51,18),('restroom',15,49),('restroom',46,51),
    ('food_corndog',10,13),('drink_coffee',29,13),('restroom',30,17),
    ('ride_haunted_house',10,8),('ride_ferris_classic',24,8),
    ('ride_teacups',13,13),('ride_tilt_a_whirl',18,13),
    ('ride_kiddie_train',23,13),('ride_ghost_train',28,14),
    ('ride_wave_swinger',27,18),
]
for kind,x,y in placements:
    place(kind,x,y)

# Fill each land with complementary rides, with a one-tile access margin.
land_rides = [
    ((10,37,22,50), ['ride_spinning_apples','ride_swing_ride','ride_antique_cars','ride_haunted_house','ride_scrambler','ride_tunnel']),
    ((39,10,52,26), ['ride_space_shot','ride_enterprise','ride_bumper_cars','ride_motion_theater','ride_top_spin','ride_star_flyer']),
    ((39,37,52,52), ['ride_log_flume','ride_rapids','ride_bumper_boats','ride_paddle_boats','ride_flying_scooters','ride_water_play']),
    ((10,18,23,29), ['ride_drop_tower','ride_frisbee','ride_inversion','ride_meteorite']),
]
for (left,top,right,bottom), kinds in land_rides:
    for kind in kinds:
        w,h=sizes.get(kind,(1,1))
        candidates=[]
        for y in range(top,bottom-h+2):
            for x in range(left,right-w+2):
                if all(empty(px,py) and not grid[py][px]['hasCoasterTrack']
                       for py in range(y-1,y+h+1) for px in range(x-1,x+w+1)):
                    candidates.append((x,y))
        if candidates:
            x,y=candidates[len(candidates)//3]
            place(kind,x,y)

# Shopfronts form streets rather than isolated dots on lawns.
shops=['shop_fudge','shop_photo','food_hotdog','drink_lemonade','shop_collectibles','food_icecream']
for index,y in enumerate(range(38,55,2)):
    for x in [27,33]:
        if empty(x,y): place(shops[index%len(shops)],x,y)

for y in range(38,43):
    for x in range(44,47):
        if empty(x,y):
            grid[y][x]['terrain']='water'
            grid[y][x]['building']['type']='water'
for x,y in [(26,27),(26,30),(26,33),(33,27),(33,30),(33,33),(28,32),(28,34)]:
    if empty(x,y) and not grid[y][x]['hasCoasterTrack']: place('flowers_bed',x,y)

# Connect every usable building to the network without crossing another footprint.
D = [(1,0),(-1,0),(0,1),(0,-1)]
def connect(x, y, kind):
    starts = [(x+dx,y+dy) for dx,dy in D if 0 <= x+dx < size and 0 <= y+dy < size
              and (empty(x+dx,y+dy) or grid[y+dy][x+dx]['path'] or grid[y+dy][x+dx]['queue'])]
    q = collections.deque(starts)
    previous = {p: None for p in starts}
    finish = None
    while q:
        p = q.popleft()
        if grid[p[1]][p[0]]['path']:
            finish = p
            break
        for dx,dy in D:
            n = (p[0]+dx,p[1]+dy)
            if n not in previous and 0 <= n[0] < size and 0 <= n[1] < size and (empty(*n) or grid[n[1]][n[0]]['path'] or grid[n[1]][n[0]]['queue']):
                previous[n] = p
                q.append(n)
    assert finish is not None, ('No entrance',kind,x,y)
    route = []
    while finish is not None:
        route.append(finish)
        finish = previous[finish]
    for px,py in route:
        if empty(px,py): road(px,py)
    if kind.startswith(('ride_', 'show_', 'station_')):
        px,py = route[-1]
        tile = grid[py][px]
        tile.update(path=False, queue=True, queueRideId=f'{x},{y}')
        tile['building']['type']='queue'

for row in grid:
    for tile in row:
        kind=tile['building']['type']
        if not kind.endswith('_footprint') and (kind in ('restroom','first_aid') or kind.startswith(('ride_','show_','station_','food_','drink_','shop_','arcade_'))):
            connect(tile['x'],tile['y'],kind)

# Castle court is a paved gathering square with planted islands.
for y in range(26,35):
    for x in range(26,35):
        if empty(x,y) and not grid[y][x]['hasCoasterTrack']: road(x,y)

# Landscaping leaves breathing room around each ride and keeps walkways clear.
for y in range(2,58,2):
    for x in range(2,58,2):
        if not empty(x,y) or grid[y][x]['hasCoasterTrack']: continue
        if any(grid[y+dy][x+dx]['path'] or grid[y+dy][x+dx]['queue'] for dx,dy in D):
            kind = 'lamp_victorian' if (x+y)%2 else 'flowers_bed'
        elif 26<=x<=34 and 26<=y<=34: kind='flowers_bed'
        elif x<27 and y>34: kind='tree_cherry'
        elif x>37 and y>34: kind='tree_palm'
        elif x>37: kind='tree_birch'
        else: kind='tree_pine'
        place(kind,x,y)

# Themed props and flower borders fill the remaining pockets without blocking paths.
for y in range(3,57):
    for x in range(3,57):
        if not empty(x,y) or grid[y][x]['hasCoasterTrack']: continue
        adjacent=any(grid[y+dy][x+dx]['path'] or grid[y+dy][x+dx]['queue'] for dx,dy in D)
        if adjacent and (x+y)%3==0:
            place('flowers_bed' if (x+y)%2 else 'bush_flowering',x,y)
        elif x%4==1 and y%4==1:
            props = ['theme_castle_tower','theme_knight_statue','theme_dragon_statue'] if x<27 and y>34 else \
                    ['theme_pirate_ship','theme_tiki_statue','theme_temple_ruins'] if x>37 and y>34 else \
                    ['theme_rocket_ship','theme_robot_statue','theme_portal'] if x>37 else \
                    ['theme_saloon','theme_water_tower','theme_windmill']
            place(props[(x+y)//4%len(props)],x,y)

# Water and planted ground replace the leftover blank lawns in each land.
for y in range(size):
    for x in range(size):
        if not empty(x,y) or grid[y][x]['hasCoasterTrack']: continue
        if x<2 or y<2 or x>57 or y>57 or (40<=x<=51 and 38<=y<=51 and (x+y)%5!=0):
            grid[y][x]['terrain']='water'
            grid[y][x]['building']['type']='water'
        elif 10<=x<=23 and 36<=y<=50 and (x+y)%3==0:
            place('flowers_wild',x,y)
        elif (x*7+y*3)%11<3:
            place('bush_flowering' if y>34 else 'tree_oak',x,y)

park.update(grid=grid,guests=[],speed=0,tick=0,hour=10,minute=0,selectedTool='select',notifications=[])
FILE.write_text(json.dumps(park,separators=(',',':'))+'\n')
print(f'Built {sum(t["building"]["type"] != "empty" for row in grid for t in row)} occupied tiles and {len(park["coasters"])} unique coasters')
