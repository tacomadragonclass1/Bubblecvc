# Generate the reef's coral geometry.
#
#   blender -b --python tools/make_coral.py -- assets/reef/coral.glb
#
# WHY THIS EXISTS. The coral used to be built from three.js primitives at
# runtime - spheres, cylinders and cones. That is fine for rocks, but coral is
# the thing the eye actually reads on the sea bed, and a smooth sphere called
# "brain coral" has none of what makes brain coral recognisable. Blender gets us
# real geometry: displacement, corrugation, recursive branching, open tube rims.
#
# WHAT IT MUST RESPECT (all of these are load-bearing, see src/reef.js):
#   * THE FIVE SILHOUETTES. One solid mass, one horizontal, one vertical rhythm,
#     one fractal and one flat net. They exist so a cluster reads as a reef and
#     not as five copies of the same shape in different colours.
#   * NO MATERIALS. Every piece is exported with no material at all, on purpose.
#     The runtime assigns the reef's own shared palette materials, which is what
#     lets mergeInto() batch a whole band into ~9 draw calls. Baking materials in
#     here would defeat that completely.
#   * A POLY BUDGET. These are instanced many times per band and merged, so
#     triangles are the cost, not draw calls. ~1-2k each.
#   * ORIGIN AT THE BASE. The runtime places coral by its foot on the sea bed,
#     so each piece sits with y=0 at the bottom and grows upward.
import bpy, bmesh, math, random, sys
from mathutils import Vector, Matrix, noise

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else 'coral.glb'
random.seed(20261024)

bpy.ops.wm.read_factory_settings(use_empty=True)

def new_mesh(name):
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob, me

def finish(ob, me, bm, smooth=True, subsurf=0):
    bm.to_mesh(me); bm.free()
    if smooth:
        for p in me.polygons: p.use_smooth = True
    if subsurf:
        bpy.context.view_layer.objects.active = ob
        m = ob.modifiers.new('s', 'SUBSURF'); m.levels = subsurf; m.render_levels = subsurf
        bpy.ops.object.modifier_apply(modifier=m.name)
    # Drop to origin-at-base and normalise height to 1 so the runtime can scale
    # every species with one number.
    me = ob.data
    zs = [v.co.z for v in me.vertices]
    lo, hi = min(zs), max(zs)
    h = max(1e-6, hi - lo)
    for v in me.vertices:
        v.co.z = (v.co.z - lo) / h
        v.co.x /= h; v.co.y /= h
    return ob

# ---------------------------------------------------------------- 1. branching
# The FRACTAL silhouette, and the cluster's focal point.
#
# ⛔ The first attempt recursed with children at 0.6-0.78 of the parent length
# and only a small lateral kick, which compounds: by depth 3 the twigs were a
# twentieth of the trunk and the whole thing was a bare stick with lint on it.
# Real staghorn coral keeps its branches LONG relative to the parent and throws
# them WIDE - the silhouette is a candelabra, not a feather. Hence 0.82 falloff
# and a big lateral component on every split.
def branching():
    ob, me = new_mesh('coral_branch')
    bm = bmesh.new()

    def tube(a, b, ra, rb, seg=7):
        d = (b - a)
        L = d.length
        if L < 1e-5: return None, None
        d = d / L
        up = Vector((0, 0, 1))
        side = d.cross(up)
        if side.length < 1e-3: side = Vector((1, 0, 0))
        side.normalize(); fwd = d.cross(side).normalized()
        rings = []
        for s_ in range(2):
            p = a if s_ == 0 else b
            r = ra if s_ == 0 else rb
            rings.append([bm.verts.new(p + (side*math.cos(k/seg*math.tau) +
                                            fwd*math.sin(k/seg*math.tau)) * r)
                          for k in range(seg)])
        for k in range(seg):
            j = (k+1) % seg
            bm.faces.new((rings[0][k], rings[0][j], rings[1][j], rings[1][k]))
        return rings[0], rings[1]

    def limb(origin, direction, length, radius, depth):
        # grow in a few segments so the limb can curve
        pos = origin.copy(); d = direction.normalized()
        n = 3
        for i in range(n):
            nxt = pos + d * (length / n)
            tube(pos, nxt, radius * (1 - i/n*0.3), radius * (1 - (i+1)/n*0.3))
            pos = nxt
            d = (d + Vector((random.uniform(-.10,.10), random.uniform(-.10,.10), 0.10))).normalized()
        if depth <= 0:
            # round the tip off rather than leaving a hole
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius*0.68,
                                       matrix=Matrix.Translation(pos))
            return
        for _ in range(random.choice((2, 2, 3))):
            # ⭐ WIDE. The lateral kick is as big as the upward one - that is what
            # makes a candelabra instead of a bottlebrush.
            lateral = Vector((random.uniform(-1, 1), random.uniform(-1, 1), 0))
            if lateral.length < 1e-3: lateral = Vector((1, 0, 0))
            lateral.normalize()
            nd = (d * 0.75 + lateral * random.uniform(0.55, 1.05)
                    + Vector((0, 0, random.uniform(0.25, 0.6)))).normalized()
            limb(pos, nd, length * random.uniform(0.74, 0.88), radius * 0.70, depth - 1)

    # three main limbs off a short trunk, so the base reads as one animal
    trunk_top = Vector((0, 0, 0.42))
    tube(Vector((0,0,0)), trunk_top, 0.20, 0.17)
    for i in range(3):
        a = i / 3 * math.tau + random.uniform(-.3, .3)
        nd = Vector((math.cos(a) * 0.62, math.sin(a) * 0.62, 1.0)).normalized()
        limb(trunk_top, nd, 0.62, 0.15, 2)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    return finish(ob, me, bm, subsurf=0)

# ------------------------------------------------------------------- 2. brain
# The SOLID MASS. What makes brain coral readable is the MEANDERING RIDGE.
#
# ⛔ The first attempt displaced by 0.05 on a radius-1 sphere and smooth-shaded
# it, and the result was a lumpy potato - the grooves were there in the data and
# invisible on screen. Two fixes: much deeper displacement, and a ridge profile
# with a SHARP valley (abs of a sine, not the sine) so the groove reads as a cut
# rather than as a gentle undulation. The sphere also needs enough segments to
# resolve the pattern at all.
def brain():
    ob, me = new_mesh('coral_brain')
    bm = bmesh.new()
    # Segments must out-resolve the groove frequency or the pattern aliases
    # into noise, but resolution is also the poly budget: this piece is instanced
    # a few times per band and merged. 58x30 still resolves the channels and costs
    # ~3.4k tris instead of 6.5k.
    bmesh.ops.create_uvsphere(bm, u_segments=58, v_segments=30, radius=1.0)
    for v in bm.verts:
        p = v.co.copy()
        n = p.normalized()
        # A warped coordinate makes the grooves WANDER instead of running in
        # parallel stripes - that wandering is the whole character of the thing.
        # ⛔ ONE LOW-FREQUENCY WARP, large. The channels of brain coral are
        # CONTINUOUS lines that wander; a high-frequency term in the warp (the
        # previous `+ noise(p*2.7)*1.1`) chops them into disconnected bumps and
        # the model reads as a generic lumpy rock. Low frequency, big amplitude
        # = bands that meander a long way without ever breaking up.
        warp = noise.noise(p * 0.85) * 5.4
        # ⛔ FREQUENCY IS THE WHOLE THING. At x*4.4 this makes about three
        # cycles across the entire sphere, which does not read as grooves - it
        # reads as lobes, and the model came out looking like a smooth potato
        # twice running. Brain coral needs MANY fine channels; ~9 cycles across
        # the body is where it starts to look like the animal it is named after.
        band = math.sin(p.x * 10.5 + p.z * 3.0 + warp)
        # abs() turns the wave into a row of sharp valleys with rounded ridges
        ridge = 1.0 - abs(band) ** 0.55
        v.co = n * (1.0 + ridge * 0.095)
        v.co.z *= 0.60                     # squat, the way a boulder coral sits
    for v in bm.verts:
        if v.co.z < -0.34: v.co.z = -0.34   # flat foot on the sea bed
    return finish(ob, me, bm, subsurf=0)

# ------------------------------------------------------------------- 3. table
# The HORIZONTAL. A broad plate on a short stem, with radial corrugation and an
# irregular rim - a perfectly round disc reads as a table, not as coral.
def table():
    ob, me = new_mesh('coral_table')
    bm = bmesh.new()
    RING, SEG = 9, 28
    # ⛔ The grid starts at an INNER RADIUS, not at zero. A polar grid that
    # converges on a point makes SEG degenerate faces all sharing one vertex,
    # which shaded as a visible pinch with a hole in the middle of the plate.
    # Starting at r0 and capping it with a fan from a single centre vertex is
    # the standard fix and it costs one vertex.
    R0 = 0.12
    grid = []
    for i in range(RING + 1):
        rr = R0 + (1 - R0) * i / RING
        row = []
        for k in range(SEG):
            a = k / SEG * math.tau
            # rim wobble so the plate edge is organic, growing toward the edge
            edge = 1 + (0.13 * math.sin(a * 3.1) + 0.08 * math.sin(a * 7.3)) * rr
            r = rr * edge
            # Domed, and corrugated RADIALLY - the ribs of a table coral run out
            # from the centre, which is also what stops the plate reading as a
            # dinner plate.
            z = 0.34 * (1 - rr * rr) + 0.045 * math.sin(a * 9) * rr
            row.append(bm.verts.new(Vector((math.cos(a) * r, math.sin(a) * r, z))))
        grid.append(row)
    for i in range(RING):
        for k in range(SEG):
            bm.faces.new((grid[i][k], grid[i][(k+1)%SEG], grid[i+1][(k+1)%SEG], grid[i+1][k]))
    centre = bm.verts.new(Vector((0, 0, 0.34)))
    for k in range(SEG):
        bm.faces.new((centre, grid[0][k], grid[0][(k+1)%SEG]))
    # Give the plate thickness, then a stem down to the floor.
    bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=-0.055)
    stem = bmesh.ops.create_cone(bm, cap_ends=True, segments=10,
                                 radius1=0.20, radius2=0.12, depth=0.62)
    for v in stem['verts']: v.co.z -= 0.34
    return finish(ob, me, bm, subsurf=0)

# ------------------------------------------------------------------- 4. pipes
# The VERTICAL RHYTHM. A clutch of open tubes at varied heights. The OPEN top is
# the whole tell - a closed cylinder is a peg, a tube with a visible bore is
# organ-pipe coral.
def pipes():
    ob, me = new_mesh('coral_pipes')
    bm = bmesh.new()
    spots = [(0,0,1.0),(.33,.12,.82),(-.28,.2,.7),(.12,-.32,.88),
             (-.34,-.22,.6),(.42,-.1,.52),(-.08,.38,.55)]
    for (x, y, hgt) in spots:
        h = hgt * random.uniform(0.85, 1.12)
        ro, ri = 0.125 * random.uniform(.85,1.15), 0.072
        rings = []
        for s in range(5):
            t = s / 4
            z = t * h
            lean = Vector((x, y, 0)) * 0.06 * t          # tubes splay slightly
            ring_o, ring_i = [], []
            for k in range(9):
                a = k / 9 * math.tau
                c, sn = math.cos(a), math.sin(a)
                base = Vector((x, y, z)) + lean
                ring_o.append(bm.verts.new(base + Vector((c*ro, sn*ro, 0))))
                ring_i.append(bm.verts.new(base + Vector((c*ri, sn*ri, 0))))
            rings.append((ring_o, ring_i))
        for s in range(4):
            (ao, ai), (bo, bi) = rings[s], rings[s+1]
            for k in range(9):
                j = (k+1) % 9
                bm.faces.new((ao[k], ao[j], bo[j], bo[k]))      # outside
                bm.faces.new((ai[j], ai[k], bi[k], bi[j]))      # bore
        to, ti = rings[-1]
        for k in range(9):
            j = (k+1) % 9
            bm.faces.new((to[k], to[j], ti[j], ti[k]))          # the open rim
        bo0, bi0 = rings[0]
        for k in range(9):
            j = (k+1) % 9
            bm.faces.new((bi0[k], bi0[j], bo0[j], bo0[k]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    return finish(ob, me, bm, subsurf=0)

# --------------------------------------------------------------------- 5. fan
# The FLAT NET, and the fussiest of the five.
#
# ⛔ A SEA FAN IS A LATTICE AND ITS STEMS MUST BE HAIR-THIN. src/reef.js learned
# that the hard way - thicken the stems even slightly and it stops reading as a
# net and becomes a solid paddle.
#
# ⛔ The first attempt here recursed like the branching coral and produced four
# scattered strands that never joined up: a bush, not a net. The fix is to stop
# recursing and build the thing POLAR - strands radiating in a plane, plus ARC
# CONNECTORS at several radii. Real gorgonians fuse where strands touch, and
# that fusing is exactly what makes it a mesh you can see through.
def fan():
    ob, me = new_mesh('coral_fan')
    bm = bmesh.new()
    R = 0.020                       # hair-thin, and it must stay that way
    SPREAD = math.radians(62)       # half-angle of the fan
    STRANDS, RINGS = 11, 6

    def node(rad, i):
        """Position of strand i at radius step rad (0..RINGS)."""
        t = rad / RINGS
        a = (i / (STRANDS - 1) - 0.5) * 2 * SPREAD
        # strands splay as they rise and wobble a little, so the mesh is organic
        a *= (0.30 + 0.70 * t)
        wob = math.sin(i * 2.1 + t * 3.4) * 0.016 * t
        rr = t * (1.0 + 0.06 * math.sin(i * 1.7))
        return Vector((math.sin(a) * rr + wob, 0.0, math.cos(a) * rr * 0.98))

    def strut(a, b, r):
        d = b - a
        L = d.length
        if L < 1e-5: return
        d = d / L
        perp = d.cross(Vector((0, 1, 0)))
        if perp.length < 1e-4: perp = Vector((1, 0, 0))
        perp.normalize()
        rings = []
        for p in (a, b):
            rings.append([bm.verts.new(p + (perp*math.cos(k/4*math.tau) +
                                            Vector((0,1,0))*math.sin(k/4*math.tau)) * r)
                          for k in range(4)])
        for k in range(4):
            j = (k+1) % 4
            bm.faces.new((rings[0][k], rings[0][j], rings[1][j], rings[1][k]))

    # radial strands
    for i in range(STRANDS):
        for rad in range(RINGS):
            # the outer reaches thin out, like a real fan
            r = R * (1 - rad / RINGS * 0.4)
            strut(node(rad, i), node(rad + 1, i), r)
    # ⭐ the cross-links that make it a NET. Skipping some keeps it irregular -
    # a complete grid reads as fabric, not as coral.
    for rad in range(2, RINGS + 1):
        for i in range(STRANDS - 1):
            if (i + rad) % 3 == 0: continue
            strut(node(rad, i), node(rad, i + 1), R * 0.62)
    # a short holdfast so it has something to stand on
    strut(Vector((0,0,-0.12)), node(0, STRANDS//2), R * 1.9)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    return finish(ob, me, bm, subsurf=0)

built = [branching(), brain(), table(), pipes(), fan()]
for ob in built:
    n = len(ob.data.polygons)
    tri = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    print('CORAL %-14s faces=%-5d tris=%-5d verts=%d' % (ob.name, n, tri, len(ob.data.vertices)))

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                          export_materials='NONE', export_animations=False,
                          export_apply=True)
print('CORAL EXPORTED', OUT)
