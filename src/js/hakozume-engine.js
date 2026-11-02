(function() {
'use strict';

// ===== 依赖检查 =====
if (typeof THREE === 'undefined') {
  console.error('hakozume-core: THREE.js not loaded');
  return;
}

let scene, camera, renderer, clock;
let personA, personB, walkGroup;
let currentView = '3rd';
let carrySide = 1; // 第三人称视角的初始朝向（1＝固定。布局设置已删除）
let boxGroup;                       // 透明箱子
let currentBox = { W: 0.9, D: 0.9, H: 1.1, locker: false };   // 当前箱子的内尺寸(m)
let solverRun = null, solverTimer = null, solveToken = 0, pendingKey = '';
let lastResult = null, lastKey = '', solving = false, variantSeed = 1;
let diceAuto = false, rerollPending = false;   // 🎲 随机选中的姿势正在同步到姿势栏时为 true（此时会从全部姿势中寻找）
let scanRun = null, scanParams = null, scanDoneKey = '';   // 后台处理：调查“这个身高下可行的姿势”
const FAMILY_NAMES = {
    between: '坐在两膝之间（不面对面）', betweenF: '坐在两膝之间（面对面）',
    laplap: '坐在大腿上（不面对面）', laplapF: '坐在大腿上（面对面）',
    facingKnees: '面对面坐下（盘腿坐）', facingWrap: '面对面坐下（用腿夹住）',
    cradle: '横抱着坐', side: '并排坐', lying: '躺卧',
    overAllFours: '四肢着地俯身覆盖', reverseStack: '反向叠着躺',
    overAllFoursWide: '四肢着地俯身覆盖（双腿张开跨过躯干）', overAllFoursOff: '四肢着地俯身覆盖（脸不重叠）',
    reverseStackWide: '反向叠着躺（双腿张开跨过躯干）',
    standFace: '面对面站立', standBack: '前后重叠站立（同向）', standSide: '并排站立'
};
const BOX_DEFAULT = { W: 90, D: 90, H: 100 };       // 箱子手动尺寸的初始值(cm)
const LOCKER_DEFAULT = { W: 60, D: 60, H: 180 };    // 清洁柜手动尺寸的初始值(cm)
let lastScan = null;                       // 最近一次“可行姿势”的调查结果
const DEFAULT_ROT_3RD = { x: 0.2, y: 0.45 }; // 第三人称初始从斜前方看
let rotation = { x: DEFAULT_ROT_3RD.x, y: DEFAULT_ROT_3RD.y }, camDist = 2.4, isDragging = false, previousTouch = null, initialPinchDist = null;

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    camera = new THREE.PerspectiveCamera(
        50,
        window.innerWidth / window.innerHeight,
        0.01,
        1000
    );

    camera.rotation.order = 'YXZ';
    
    renderer = new THREE.WebGLRenderer({ antialias: true });

    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);

    document.getElementById('canvas-container')
        .appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2.5));
    scene.add(new THREE.GridHelper(200, 400, 0xeeeeee, 0xf5f5f5));

    walkGroup = new THREE.Group();
    scene.add(walkGroup);
    boxGroup = new THREE.Group();
    scene.add(boxGroup);

    clock = new THREE.Clock();

    setupControls();

    window.addEventListener('resize', onWindowResize);
    
    window.updateScene = updateScene;
    window.switchView = switchView;
    window.swapAB = swapAB;
    window.shareToX = shareToX;
    window.reroll = reroll;
    window.onPoseSelect = onPoseSelect;
    window.onBoxTypeChange = onBoxTypeChange;

    window.togglePanel = () => {
        const panel = document.getElementById('ui-panel');
        const text = document.getElementById('toggle-text');
        panel.classList.toggle('collapsed');
        text.innerText = panel.classList.contains('collapsed') ? '展开' : '收起';
    };

    // 输入框失焦时，把面板的滚动位置重置回顶部
    document.querySelectorAll('#ui-panel input, #ui-panel select').forEach(element => {
        element.addEventListener('blur', () => {
            const panel = document.getElementById('ui-panel');
            if (panel) {
                panel.scrollTop = 0;
            }
            // 防止 iOS Safari 等设备上整屏偏移的对策
            window.scrollTo(0, 0);
        });
    });

    updateScene();
    animate();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function swapAB() {
    const fields = ['name', 'gender', 'height', 'color'];
    fields.forEach(field => {
        const elA = document.getElementById(field + 'A');
        const elB = document.getElementById(field + 'B');
        const tmp = elA.value;
        elA.value = elB.value;
        elB.value = tmp;
    });
    updateScene();
}

function createMannequin(color, heightCm, gender, name, role, otherConfig) {
    const group = new THREE.Group();
    const h = heightCm * 0.01;
    const bodyMat = new THREE.MeshPhongMaterial({
        color: color,
        transparent: true,
        opacity: 0.85
    });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222222 });

    const headH = h * 0.13;
    const neckH = h * 0.05;
    const torsoH = h * 0.37;
    const legH = h * 0.45;
    const eyeY = h * 0.94;
    const torsoW = (gender === 'male' ? 0.26 : 0.21) * (h/1.7);
    const torsoDepth = torsoW * 0.5;

    const headBox = new THREE.Group();
    headBox.position.y = eyeY;
    const head = new THREE.Mesh(new THREE.SphereGeometry(headH * 0.8, 16, 16), bodyMat);
    head.position.y = (h - headH * 0.5) - eyeY;
    headBox.add(head);

    [-1, 1].forEach(side => {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(headH * 0.12, 12, 12), eyeMat);
        eye.position.set(side * (headH * 0.28), 0, (headH * 0.7));
        headBox.add(eye);
    });
    group.add(headBox);
    group.headParts = headBox;

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(headH*0.3, headH*0.3, neckH, 16), bodyMat);
    neck.position.y = h - headH - (neckH * 0.5);
    group.add(neck);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(torsoW, torsoH, torsoDepth), bodyMat);
    torso.position.y = legH + (torsoH * 0.5);
    group.add(torso);

    group.arms = [];
    const armThickness = torsoW * 0.3;
    const shoulderW = (torsoW * 0.5) + (armThickness * 0.2); // 把肩膀的旋转轴放在紧贴躯干侧面的位置，即使活动手臂也不会离躯干太远（数值越大越远）
    const shoulderY = legH + torsoH - (torsoW * 0.15); 
    const armLen = h * 0.38;

    [-1, 1].forEach(side => {
        const anchor = new THREE.Group();
        anchor.position.set(side * shoulderW, shoulderY, 0);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(armThickness, armLen, torsoW*0.3), bodyMat);
        mesh.position.y = -armLen * 0.5;
        anchor.add(mesh);
        group.add(anchor);
        group.arms.push(anchor);
    });

    group.legs = [];
    [-1, 1].forEach(side => {
        const anchor = new THREE.Group();
        anchor.position.set( side * (torsoW * 0.25), legH, 0 );
        const mesh = new THREE.Mesh(new THREE.BoxGeometry( torsoW*0.4, legH, torsoW*0.4 ), bodyMat);
        mesh.position.y = -legH * 0.5;
        anchor.add(mesh);
        group.add(anchor);
        group.legs.push(anchor);
    });

    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = "bold 45px sans-serif"; ctx.fillStyle = "#333"; ctx.textAlign = "center";
    const displayName = name || (role === 'B' ? 'B' : 'A');
    ctx.fillText(`${displayName} (${heightCm.toFixed(1)}cm)`, 256, 64);
    const spriteMaterial = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(1.5, 0.38, 1);
    sprite.position.y = h + 0.3;
    group.add(sprite);
    group.nameTag = sprite;

    group.userData = { height: h, eyeY: eyeY, role: role, depth: torsoDepth, width: torsoW, armThick: armThickness, legH: legH, torsoH: torsoH, shoulderW: shoulderW, shoulderY: shoulderY };
    group.position.y = 0; group.position.z = 0;
    return group;
}

// ===================================================================
// 装箱求解器：自动寻找身体互不陷入・不穿进箱壁、关节不别扭的姿势
// （不依赖 three.js 的计算部分。手臂・腿按两段的箱体形状直接做碰撞判定）
// ===================================================================
// ================= 装箱求解器（不依赖 three.js 的纯数学） ==================
const PI = Math.PI;
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function gauss(r){let u=0,v=0;while(u===0)u=r();while(v===0)v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*PI*v);}
function clampN(v,a,b){return v<a?a:(v>b?b:v);}

// ----- 四元数 [x,y,z,w] -----
function qMul(a,b){return [a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1], a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0], a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3], a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];}
function qX(a){return [Math.sin(a/2),0,0,Math.cos(a/2)];}
function qY(a){return [0,Math.sin(a/2),0,Math.cos(a/2)];}
function qZ(a){return [0,0,Math.sin(a/2),Math.cos(a/2)];}
function qInv(q){return [-q[0],-q[1],-q[2],q[3]];}
function qRot(q,v){
    const x=q[0],y=q[1],z=q[2],w=q[3];
    const ix=w*v[0]+y*v[2]-z*v[1], iy=w*v[1]+z*v[0]-x*v[2], iz=w*v[2]+x*v[1]-y*v[0], iw=-x*v[0]-y*v[1]-z*v[2];
    return [ix*w+iw*-x+iy*-z-iz*-y, iy*w+iw*-y+iz*-x-ix*-z, iz*w+iw*-z+ix*-y-iy*-x];
}
function qAxes(q){
    const x=q[0],y=q[1],z=q[2],w=q[3];
    const xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;
    return [1-2*(yy+zz),2*(xy+wz),2*(xz-wy), 2*(xy-wz),1-2*(xx+zz),2*(yz+wx), 2*(xz+wy),2*(yz-wx),1-2*(xx+yy)];
}
function vAdd(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
function vScale(a,s){return [a[0]*s,a[1]*s,a[2]*s];}
// 把朝正下方的棍子转向 d 的方向（与 three.js 的 aim() 相同：旋转顺序 XYZ）
function qAim(d){
    const l=Math.hypot(d[0],d[1],d[2])||1;
    const dx=d[0]/l, dy=d[1]/l, dz=d[2]/l;
    return qMul(qX(Math.atan2(-dz,-dy)), qZ(Math.asin(clampN(dx,-1,1))));
}

// ----- 身体尺寸（与 createMannequin 相同的比例） -----
function makeDims(heightCm, gender){
    const h=heightCm*0.01, headH=h*0.13, neckH=h*0.05, torsoH=h*0.37, legH=h*0.45;
    const torsoW=(gender==='male'?0.26:0.21)*(h/1.7), torsoD=torsoW*0.5;
    const armT=torsoW*0.3, legT=torsoW*0.4;
    const shoulderW=torsoW*0.5+armT*0.2;
    const shoulderY=legH+torsoH-torsoW*0.15;
    return {h,headH,neckH,torsoH,legH,torsoW,torsoD,armT,legT,shoulderW,
        shoulderYRel:shoulderY-legH, armHalf:h*0.38/2, legHalf:legH/2, headR:headH*0.8,
        headYRel:h-headH*0.5-legH, legX:torsoW*0.25};
}

// ----- 姿势参数 -----
// 身体: [px,py,pz,yaw,pitch,roll, 脊柱前后,脊柱左右,脊柱扭转, 左腿(髋屈曲,张开,扭转,膝), 右腿(同)]
const GN=17;
const G_LO=[-3,0,-3,-1e9,-1.8,-1.8,-0.5,-0.5,-0.8, -0.5,-0.35,-1.0,0, -0.5,-0.35,-1.0,0];
const G_HI=[ 3,3, 3, 1e9, 1.8, 1.8, 1.25,0.5,0.8,  2.1,1.0,1.2,2.55,  2.1,1.0,1.2,2.55];
const G_SIG=[0.05,0.03,0.05,0.25,0.25,0.15,0.18,0.12,0.2, 0.25,0.15,0.25,0.3, 0.25,0.15,0.25,0.3];
// 手臂: [左(肩前,肩张开,肩扭转,肘), 右(同)]
const A_LO=[-0.9,-0.5,-1.2,0, -0.9,-0.5,-1.2,0];
const A_HI=[ 2.9, 2.6, 1.2,2.5,  2.9, 2.6, 1.2,2.5];
const ARM_NEUTRAL=[0.15,0.3,0,0.45, 0.15,0.3,0,0.45];

function limbDirsArm(arm,i){
    const s=i===0?-1:1, o=i*4;
    const f=arm[o],a=arm[o+1],r=arm[o+2],e=arm[o+3];
    const Rh=qMul(qMul(qZ(s*a),qX(-f)),qY(-s*r));
    return {dU:qRot(Rh,[0,-1,0]), dL:qRot(qMul(Rh,qX(-e)),[0,-1,0])};
}
// ana=true 时采用“先把腿向两侧张开再向前抬”的解剖学顺序（坐着时膝盖也能左右打开）。
// ana=false 与以往相同（不改变其它姿势的形状）
function limbDirsLeg(g,i,ana){
    const s=i===0?-1:1, o=9+i*4;
    const flex=g[o],abd=g[o+1],ext=g[o+2],knee=g[o+3];
    const Rh=ana?qMul(qMul(qX(-flex),qZ(s*abd)),qY(-s*ext)):qMul(qMul(qZ(s*abd),qX(-flex)),qY(-s*ext));
    return {dU:qRot(Rh,[0,-1,0]), dL:qRot(qMul(Rh,qX(knee)),[0,-1,0])};
}
function rootQ(g){return qMul(qMul(qY(g[3]),qX(g[4])),qZ(g[5]));}
function spineQ(g){return qMul(qMul(qX(g[6]),qZ(g[7])),qY(g[8]));}

// ----- 用于碰撞判定的部件 -----
function mkObb(c,q,e){
    const a=qAxes(q);
    const ex=e[0]*Math.abs(a[0])+e[1]*Math.abs(a[3])+e[2]*Math.abs(a[6]);
    const ey=e[0]*Math.abs(a[1])+e[1]*Math.abs(a[4])+e[2]*Math.abs(a[7]);
    const ez=e[0]*Math.abs(a[2])+e[1]*Math.abs(a[5])+e[2]*Math.abs(a[8]);
    return {s:false,c,a,e,ex,ey,ez,br:Math.hypot(e[0],e[1],e[2])};
}
function mkSphere(c,r){return {s:true,c,r,ex:r,ey:r,ez:r,br:r};}
// 手臂・腿（两段＋关节）
function limb(frameQ,origin,dU,dL,half,t,P,idx){
    const qU=qAim(dU);
    const qa=qMul(frameQ,qU);
    const downU=qRot(qa,[0,-1,0]);
    const dLloc=qRot(qInv(qU),dL);
    const qb=qMul(qa,qAim(dLloc));
    const downL=qRot(qb,[0,-1,0]);
    const knee=vAdd(origin,vScale(downU,half));
    P[idx]=mkObb(vAdd(origin,vScale(downU,half/2)),qa,[t/2,half/2,t/2]);
    P[idx+1]=mkObb(vAdd(knee,vScale(downL,half/2)),qb,[t/2,half/2,t/2]);
    return vAdd(knee,vScale(downL,half));
}
// 0躯干 1头 2左上臂 3左前臂 4右上臂 5右前臂 6左大腿 7左小腿 8右大腿 9右小腿
function buildBody(d,g,arm,ana){
    const Rr=rootQ(g), Rt=qMul(Rr,spineQ(g));
    const hip=[g[0],g[1],g[2]];
    const P=new Array(10);
    P[0]=mkObb(vAdd(hip,qRot(Rt,[0,d.torsoH/2,0])),Rt,[d.torsoW/2,d.torsoH/2,d.torsoD/2]);
    P[1]=mkSphere(vAdd(hip,qRot(Rt,[0,d.headYRel,0])),d.headR);
    P.hands=[null,null]; P.feet=[null,null];
    for(let i=0;i<2;i++){
        const s=i===0?-1:1;
        const sh=vAdd(hip,qRot(Rt,[s*d.shoulderW,d.shoulderYRel,0]));
        const dr=limbDirsArm(arm,i);
        P.hands[i]=limb(Rt,sh,dr.dU,dr.dL,d.armHalf,d.armT,P,2+i*2);
    }
    for(let i=0;i<2;i++){
        const s=i===0?-1:1;
        const an=vAdd(hip,qRot(Rr,[s*d.legX,0,0]));
        const dr=limbDirsLeg(g,i,ana);
        P.feet[i]=limb(Rr,an,dr.dU,dr.dL,d.legHalf,d.legT,P,6+i*2);
    }
    P.hip=hip; P.Rt=Rt;
    return P;
}

// ----- 碰撞深度 -----
function obbDepth(A,B){
    const t0=B.c[0]-A.c[0], t1=B.c[1]-A.c[1], t2=B.c[2]-A.c[2];
    const a=A.a,b=B.a,ea=A.e,eb=B.e;
    let best=1e9;
    for(let i=0;i<3;i++){
        const ax=a[3*i],ay=a[3*i+1],az=a[3*i+2];
        const dist=Math.abs(t0*ax+t1*ay+t2*az);
        const rb=eb[0]*Math.abs(ax*b[0]+ay*b[1]+az*b[2])+eb[1]*Math.abs(ax*b[3]+ay*b[4]+az*b[5])+eb[2]*Math.abs(ax*b[6]+ay*b[7]+az*b[8]);
        const ov=ea[i]+rb-dist; if(ov<=0) return 0; if(ov<best) best=ov;
    }
    for(let j=0;j<3;j++){
        const bx=b[3*j],by=b[3*j+1],bz=b[3*j+2];
        const dist=Math.abs(t0*bx+t1*by+t2*bz);
        const ra=ea[0]*Math.abs(bx*a[0]+by*a[1]+bz*a[2])+ea[1]*Math.abs(bx*a[3]+by*a[4]+bz*a[5])+ea[2]*Math.abs(bx*a[6]+by*a[7]+bz*a[8]);
        const ov=eb[j]+ra-dist; if(ov<=0) return 0; if(ov<best) best=ov;
    }
    for(let i=0;i<3;i++){
        const ax=a[3*i],ay=a[3*i+1],az=a[3*i+2];
        for(let j=0;j<3;j++){
            const bx=b[3*j],by=b[3*j+1],bz=b[3*j+2];
            let nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
            const l=Math.sqrt(nx*nx+ny*ny+nz*nz);
            if(l<1e-3) continue;
            nx/=l;ny/=l;nz/=l;
            const dist=Math.abs(t0*nx+t1*ny+t2*nz);
            const ra=ea[0]*Math.abs(nx*a[0]+ny*a[1]+nz*a[2])+ea[1]*Math.abs(nx*a[3]+ny*a[4]+nz*a[5])+ea[2]*Math.abs(nx*a[6]+ny*a[7]+nz*a[8]);
            const rb=eb[0]*Math.abs(nx*b[0]+ny*b[1]+nz*b[2])+eb[1]*Math.abs(nx*b[3]+ny*b[4]+nz*b[5])+eb[2]*Math.abs(nx*b[6]+ny*b[7]+nz*b[8]);
            const ov=ra+rb-dist; if(ov<=0) return 0; if(ov<best) best=ov;
        }
    }
    return best;
}
// 带符号距离（正＝分离：SAT 的最大分离量，负＝陷入）
function obbSep(A,B){
    const t0=B.c[0]-A.c[0], t1=B.c[1]-A.c[1], t2=B.c[2]-A.c[2];
    const a=A.a,b=B.a,ea=A.e,eb=B.e;
    let best=-1e9;
    for(let i=0;i<3;i++){
        const ax=a[3*i],ay=a[3*i+1],az=a[3*i+2];
        const dist=Math.abs(t0*ax+t1*ay+t2*az);
        const rb=eb[0]*Math.abs(ax*b[0]+ay*b[1]+az*b[2])+eb[1]*Math.abs(ax*b[3]+ay*b[4]+az*b[5])+eb[2]*Math.abs(ax*b[6]+ay*b[7]+az*b[8]);
        const s=dist-ea[i]-rb; if(s>best) best=s;
    }
    for(let j=0;j<3;j++){
        const bx=b[3*j],by=b[3*j+1],bz=b[3*j+2];
        const dist=Math.abs(t0*bx+t1*by+t2*bz);
        const ra=ea[0]*Math.abs(bx*a[0]+by*a[1]+bz*a[2])+ea[1]*Math.abs(bx*a[3]+by*a[4]+bz*a[5])+ea[2]*Math.abs(bx*a[6]+by*a[7]+bz*a[8]);
        const s=dist-eb[j]-ra; if(s>best) best=s;
    }
    return best;
}
function sphereObbDepth(S,O){
    const dx=S.c[0]-O.c[0],dy=S.c[1]-O.c[1],dz=S.c[2]-O.c[2];
    const a=O.a,e=O.e;
    const l0=dx*a[0]+dy*a[1]+dz*a[2], l1=dx*a[3]+dy*a[4]+dz*a[5], l2=dx*a[6]+dy*a[7]+dz*a[8];
    const c0=clampN(l0,-e[0],e[0]), c1=clampN(l1,-e[1],e[1]), c2=clampN(l2,-e[2],e[2]);
    const q0=l0-c0,q1=l1-c1,q2=l2-c2;
    const d2=q0*q0+q1*q1+q2*q2;
    if(d2>1e-12){const dd=Math.sqrt(d2); return S.r-dd>0?S.r-dd:0;}
    const m=Math.min(e[0]-Math.abs(l0),e[1]-Math.abs(l1),e[2]-Math.abs(l2));
    return S.r+m;
}
function pairDepth(P,Q){
    const dx=P.c[0]-Q.c[0],dy=P.c[1]-Q.c[1],dz=P.c[2]-Q.c[2];
    const rr=P.br+Q.br;
    if(dx*dx+dy*dy+dz*dz>=rr*rr) return 0;
    if(P.s){
        if(Q.s){const d=Math.sqrt(dx*dx+dy*dy+dz*dz);const v=P.r+Q.r-d;return v>0?v:0;}
        return sphereObbDepth(P,Q);
    }
    if(Q.s) return sphereObbDepth(Q,P);
    return obbDepth(P,Q);
}
// 点到 OBB 表面的距离
function pointObbDist(p,O){
    const dx=p[0]-O.c[0],dy=p[1]-O.c[1],dz=p[2]-O.c[2];
    if(O.s){return Math.max(0,Math.sqrt(dx*dx+dy*dy+dz*dz)-O.r);}
    const a=O.a,e=O.e;
    const l0=dx*a[0]+dy*a[1]+dz*a[2], l1=dx*a[3]+dy*a[4]+dz*a[5], l2=dx*a[6]+dy*a[7]+dz*a[8];
    const q0=l0-clampN(l0,-e[0],e[0]),q1=l1-clampN(l1,-e[1],e[1]),q2=l2-clampN(l2,-e[2],e[2]);
    return Math.sqrt(q0*q0+q1*q1+q2*q2);
}

// 自身各部位之间的干涉判定（排除相邻关节・允许少量重叠）
const SELF_PAIRS=[
    [1,2,0.012],[1,4,0.012],[1,3,0.004],[1,5,0.004],[1,6,0],[1,7,0],[1,8,0],[1,9,0],
    [0,2,0.03],[0,4,0.03],[0,3,0.012],[0,5,0.012],[0,7,0.01],[0,9,0.01],
    [2,4,0.004],[2,5,0.004],[3,4,0.004],[3,5,0.004],
    [2,6,0.004],[2,7,0.004],[2,8,0.004],[2,9,0.004],[3,6,0.004],[3,7,0.004],[3,8,0.004],[3,9,0.004],
    [4,6,0.004],[4,7,0.004],[4,8,0.004],[4,9,0.004],[5,6,0.004],[5,7,0.004],[5,8,0.004],[5,9,0.004],
    [6,8,0.004],[6,9,0.004],[7,8,0.004],[7,9,0.004]
];
const NOARM_IDX=[0,1,6,7,8,9];
function selfPen(P,useArms){
    let s=0;
    for(let k=0;k<SELF_PAIRS.length;k++){
        const pr=SELF_PAIRS[k];
        if(!useArms && (pr[0]>=2&&pr[0]<=5||pr[1]>=2&&pr[1]<=5)) continue;
        const v=pairDepth(P[pr[0]],P[pr[1]])-pr[2];
        if(v>0) s+=v;
    }
    return s;
}
function bodyVolWeights(d){
    return [8*d.torsoW/2*d.torsoH/2*d.torsoD/2, 4/3*PI*d.headR*d.headR*d.headR,
        d.armT*d.armT*d.armHalf,d.armT*d.armT*d.armHalf,d.armT*d.armT*d.armHalf,d.armT*d.armT*d.armHalf,
        d.legT*d.legT*d.legHalf,d.legT*d.legT*d.legHalf,d.legT*d.legT*d.legHalf,d.legT*d.legT*d.legHalf];
}

// ================= 評価関数 =================
// ctx: {dA,dB,box:{auto,W,D,H},wA:[],wB:[],opt:{...}}
function evalPose(ctx,gA,aA,gB,aB,useArms){
    const PA=buildBody(ctx.dA,gA,aA,ctx.ana), PB=buildBody(ctx.dB,gB,aB,ctx.ana);
    return evalParts(ctx,PA,PB,gA,gB,useArms);
}
function boxViol(ctx,P,idxs,bb){
    const box=ctx.box; let v=0;
    for(let k=0;k<idxs.length;k++){
        const p=P[idxs[k]]; const c=p.c;
        const y0=c[1]-p.ey; if(y0<0) v+=-y0;
        if(bb){
            const x0=c[0]-p.ex,x1=c[0]+p.ex,z0=c[2]-p.ez,z1=c[2]+p.ez,y1=c[1]+p.ey;
            if(x0<bb.x0)bb.x0=x0; if(x1>bb.x1)bb.x1=x1; if(z0<bb.z0)bb.z0=z0; if(z1>bb.z1)bb.z1=z1; if(y1>bb.y1)bb.y1=y1;
        }
        if(!box.auto){
            const hx=box.W/2,hz=box.D/2;
            if(c[0]+p.ex>hx) v+=c[0]+p.ex-hx; if(c[0]-p.ex<-hx) v+=-hx-(c[0]-p.ex);
            if(c[2]+p.ez>hz) v+=c[2]+p.ez-hz; if(c[2]-p.ez<-hz) v+=-hz-(c[2]-p.ez);
            if(c[1]+p.ey>box.H) v+=c[1]+p.ey-box.H;
        }
    }
    return v;
}
const ALL_IDX=[0,1,2,3,4,5,6,7,8,9];
function evalParts(ctx,PA,PB,gA,gB,useArms){
    const idx=useArms?ALL_IDX:NOARM_IDX;
    const bb={x0:1e9,x1:-1e9,z0:1e9,z1:-1e9,y1:-1e9};
    let boxV=boxViol(ctx,PA,idx,bb)+boxViol(ctx,PB,idx,bb);
    let pair=0,pairMax=0;
    for(let i=0;i<idx.length;i++){
        for(let j=0;j<idx.length;j++){
            const v=pairDepth(PA[idx[i]],PB[idx[j]]);
            if(v>0){pair+=v; if(v>pairMax)pairMax=v;}
        }
    }
    const self=selfPen(PA,useArms)+selfPen(PB,useArms);
    const viol=boxV+pair+self;
    const W=ctx.W;
    // ---- 质量项 ----
    let Q=0;
    // 重力（重心越低越稳定）
    let my=0,mt=0;
    for(let k=0;k<idx.length;k++){ my+=ctx.wA[idx[k]]*PA[idx[k]].c[1]+ctx.wB[idx[k]]*PB[idx[k]].c[1]; mt+=ctx.wA[idx[k]]+ctx.wB[idx[k]]; }
    Q+=W.grav*(my/mt);
    // 躯干彼此贴近
    const gap=obbSep(PA[0],PB[0]);
    if(gap>0.015) Q+=W.contact*(gap-0.015);
    // 脸靠近
    const hd=Math.hypot(PA[1].c[0]-PB[1].c[0],PA[1].c[1]-PB[1].c[1],PA[1].c[2]-PB[1].c[2])-(PA[1].r+PB[1].r);
    if(hd>0.06) Q+=W.face*(hd-0.06);
    // 颈部扭转（朝向能否看到对方的脸）
    Q+=W.gaze*(gazeExcess(PA,PB)+gazeExcess(PB,PA));
    // 不做作的姿势
    Q+=W.comfort*(comfort(gA)+comfort(gB));
    // 躯干倾斜（偏好坐姿）
    Q+=W.tilt*(tilt(PA)+tilt(PB));
    if(ctx.box.auto){
        const vol=(bb.x1-bb.x0)*(bb.z1-bb.z0)*bb.y1;
        Q+=W.vol*vol;
        // 储物柜为竖向，体积差异不易体现，因此尽量减小占地面积（宽×深）
        if(ctx.box.locker) Q+=W.foot*(bb.x1-bb.x0)*(bb.z1-bb.z0);
    } else {
        // 手动尺寸：宽松利用箱内空间（尽量铺开底面，并收在箱子中央）
        Q-=W.space*(Math.min(1,(bb.x1-bb.x0)/ctx.box.W)+Math.min(1,(bb.z1-bb.z0)/ctx.box.D));
        Q+=W.center*(Math.abs((bb.x0+bb.x1)/2)+Math.abs((bb.z0+bb.z1)/2));
    }
    // 是否偏离所选姿势的模板（偏离越多扣分越多）
    BOXH=ctx.box.auto?9:ctx.box.H;
    const fpen=ctx.fp?famPen(ctx.fp,gA,gB,PA,PB):0;
    const J=W.viol*viol+Q+W.fam*fpen;
    return {J,viol,boxV,pair,pairMax,self,Q,bb,fpen,pv:pair+self,Qf:Q+W.fam*fpen,W:W.viol};
}

// ================= 姿势模板的约束 ==================
// fp={fam,top}：top＝坐在上方／坐在前方的一方（0=A, 1=B）。另一方作为支撑（B 侧）
function exc(v,lo,hi){return v<lo?lo-v:(v>hi?v-hi:0);}
function pFwd(g){const f=qRot(rootQ(g),[0,0,1]);const l=Math.hypot(f[0],f[2])||1;return [f[0]/l,f[2]/l];}
function torsoTilt(P){return Math.acos(clampN(P[0].a[4],-1,1));}
// 坐着的人的“自然姿势”：骨盆・脊柱不过度后倒／双腿不在内侧交叉／上身不过度倾斜
function sitPen(g,P,lim){
    let p=exc(Math.abs(g[4]),0,0.3)+exc(Math.abs(g[5]),0,0.2)+exc(g[6],-0.3,0.5)+exc(Math.abs(g[7]),0,0.2)+exc(Math.abs(g[8]),0,0.4);
    p+=exc(g[10],-0.05,9)+exc(g[14],-0.05,9);
    p+=exc(Math.abs(g[9]-g[13]),0,0.5)+exc(Math.abs(g[12]-g[16]),0,0.9); // 让左右腿保持一致
    p+=exc(torsoTilt(P),0,lim);
    return p;
}
// 盘腿坐：收拢大腿，膝盖深屈
function kneesUp(g){return exc(g[9],1.5,9)+exc(g[13],1.5,9)+exc(g[12],1.5,9)+exc(g[16],1.5,9);}
// 采用“解剖学顺序”活动腿部的姿势（膝盖左右打开／用腿跨过／笔直站立）
const ALLFOURS_FAMS={overAllFours:1,overAllFoursWide:1,overAllFoursOff:1};
const ANA_FAMS={overAllFours:1,overAllFoursWide:1,overAllFoursOff:1,reverseStack:1,reverseStackWide:1,between:1,betweenF:1,facingWrap:1,standFace:1,standBack:1,standSide:1};
function setFp(ctx,fp){ ctx.fp=fp; ctx.ana=!!ANA_FAMS[fp.fam]; }
// 膝盖（大腿末端）的位置
function kneePt(P,k){const o=P[k],a=o.a,h=o.e[1];return [o.c[0]-a[3]*h,o.c[1]-a[4]*h,o.c[2]-a[5]*h];}
// 支撑者 S 的横向（S 的右方向）坐标
function latOf(ph,fS,p){return (p[0]-ph[0])*fS[1]-(p[2]-ph[2])*fS[0];}
// 支撑者 S 是否双膝打开，让 T 的躯干收在其间（张开的空间）
function openKnees(PS,PT,fS,gap){
    const ph=PS.hip, lT=latOf(ph,fS,PT[0].c), need=PT[0].e[0]+gap;
    let p=0;
    for(const kk of [[6,-1],[8,1]]){
        const k=kk[0], sg=kk[1];
        p+=exc(sg*(latOf(ph,fS,kneePt(PS,k))-lT),need,9)+exc(sg*(latOf(ph,fS,PS[k].c)-lT),need-0.05,9);
    }
    return p;
}
// 站立者的“自然姿势”：脚踩地面，膝盖・上身基本保持笔直
let BOXH=9;   // 当前评估的箱子高度(m)。自动尺寸时足够高
function standPen(g,P,lim){
    // 仅在笔直站立的身高装不下时才允许弯曲膝盖・上身
    const standH=2*(P[6].e[1]+P[7].e[1])+Math.hypot(P[1].c[0]-P.hip[0],P[1].c[1]-P.hip[1],P[1].c[2]-P.hip[2])+P[1].r;
    const cr=BOXH<standH+0.02;
    let p=exc(P.feet[0][1],-0.05,0.05)+exc(P.feet[1][1],-0.05,0.05);
    p+=exc(g[9],-0.2,cr?2.0:0.4)+exc(g[13],-0.2,cr?2.0:0.4)+exc(g[12],0,cr?2.4:0.4)+exc(g[16],0,cr?2.4:0.4);
    p+=exc(Math.abs(g[4]),0,0.15)+exc(Math.abs(g[5]),0,0.1)+exc(g[6],-0.2,cr?0.9:0.35)+exc(Math.abs(g[7]),0,0.12)+exc(Math.abs(g[8]),0,0.3);
    p+=exc(Math.abs(g[9]-g[13]),0,0.35)+exc(Math.abs(g[12]-g[16]),0,0.35);
    p+=exc(torsoTilt(P),0,cr?0.9:lim);
    return p;
}
// 四肢着地类（张开双腿／脸不重叠）的共同约束：T＝仰躺，S＝在其上方四肢着地
function allFoursPen(gT,gS,PT,PS,mode){
    const aT=PT[0].a, aS=PS[0].a, cT=PT[0].c, cS=PS[0].c;
    const lT=Math.hypot(aT[3],aT[5])||1, lS=Math.hypot(aS[3],aS[5])||1;
    const dot=(aT[3]*aS[3]+aT[5]*aS[5])/(lT*lS);
    const ux=aT[3]/lT, uz=aT[5]/lT, wT=PT[0].e[0], hT=PT[0].e[1];
    const cx=cS[0]-cT[0], cz=cS[2]-cT[2], cy=cS[1]-cT[1];
    let p=exc(Math.abs(aT[4]),0,0.3)+exc(aT[7],0.7,1)+exc(Math.abs(aS[4]),0,0.45)+exc(-aS[7],0.55,1)+exc(cy,0.22,0.8);
    const kl=kneePt(PS,6), kr=kneePt(PS,8);
    p+=exc(kl[1],-9,0.1)+exc(kr[1],-9,0.1);   // 膝盖接触地面
    const l1=(kl[0]-cT[0])*uz-(kl[2]-cT[2])*ux, l2=(kr[0]-cT[0])*uz-(kr[2]-cT[2])*ux;
    if(mode==='wide'){
        const m=wT+0.07;   // 膝盖位于躯干外侧（两腋外侧）
        p+=exc(dot,0.6,1)+exc(Math.hypot(cx,cz),0,0.28)
          +exc(l1*l2,-9,-m*m)+exc(Math.abs(l1),m,9)+exc(Math.abs(l2),m,9)
          +exc(gS[10],0.4,9)+exc(gS[14],0.4,9);
        for(const k of [kl,kr]) p+=exc(Math.abs((k[0]-cT[0])*ux+(k[2]-cT[2])*uz),0,hT);   // 膝盖要在躯干的长度范围内
    } else {
        const m=wT/2+0.02, hs=PS[1].c, ht=PT[1].c;
        p+=exc(dot,-1,-0.5)+exc(Math.hypot(cx,cz),0,0.4)
          +exc(l1*l2,-9,-m*m)+exc(Math.abs(l1),m,9)+exc(Math.abs(l2),m,9)
          +exc(gS[10],0.05,9)+exc(gS[14],0.05,9);
        p+=exc(Math.hypot(hs[0]-ht[0],hs[2]-ht[2]),PS[1].r+PT[1].r+0.15,9);          // 脸与脸不重叠
        p+=exc(Math.hypot(hs[0]-PT.hip[0],hs[2]-PT.hip[2]),0,0.22);                   // 覆盖者的头位于对方躯干与腿交界处的上方
        p+=exc(Math.hypot(ht[0]-PS.hip[0],ht[2]-PS.hip[2]),0,0.22);                   // 对方的头位于覆盖者躯干与腿交界处的下方
    }
    return p;
}
function famPen(fp,gA,gB,PA,PB){
    const t=fp.top;
    const gT=t?gB:gA, gS=t?gA:gB, PT=t?PB:PA, PS=t?PA:PB;
    const fT=pFwd(gT), fS=pFwd(gS);
    const ang=Math.acos(clampN(fT[0]*fS[0]+fT[1]*fS[1],-1,1)); // 朝向之差（0＝同向，π＝面对面）
    const rx=gT[0]-gS[0], rz=gT[2]-gS[2], ry=gT[1]-gS[1];
    const fw=rx*fS[0]+rz*fS[1];                 // 相对支撑者前方的偏移
    const lat=Math.abs(rx*fS[1]-rz*fS[0]);      // 左右偏移
    let p=0;
    switch(fp.fam){
    case 'between': // 支撑者双膝打开，A 以相同朝向坐在中间的地面上
        p+=exc(ang,0,0.35)+exc(fw,0.10,0.36)+exc(lat,0,0.08)+exc(ry,-0.10,0.05)+exc(gS[10],0.35,9)+exc(gS[14],0.35,9)+openKnees(PS,PT,fS,0.03)+sitPen(gT,PT,0.5)+sitPen(gS,PS,0.5);
        break;
    case 'laplap': // 以相同朝向坐在支撑者的大腿上
        p+=exc(ang,0,0.35)+exc(fw,0.08,0.38)+exc(lat,0,0.10)+exc(ry,0.08,0.35)+sitPen(gT,PT,0.55)+sitPen(gS,PS,0.5);
        break;
    case 'betweenF': // 支撑者双膝打开，对着脸坐在中间的地面上
        p+=exc(Math.PI-ang,0,0.35)+exc(fw,0.20,0.60)+exc(lat,0,0.08)+exc(ry,-0.10,0.05)+exc(gS[10],0.3,9)+exc(gS[14],0.3,9)+exc(gS[1],0,0.12)+exc(gT[1],0,0.15)+openKnees(PS,PT,fS,0.02)+sitPen(gT,PT,0.5)+sitPen(gS,PS,0.5);
        break;
    case 'laplapF': // 在大腿上相对而坐
        p+=exc(Math.PI-ang,0,0.35)+exc(fw,0.10,0.40)+exc(lat,0,0.10)+exc(ry,0.08,0.35)+exc(gS[1],0,0.12)+sitPen(gT,PT,0.6)+sitPen(gS,PS,0.5);
        break;
    case 'facingKnees': // 两人都在地上盘腿坐（屈膝）相对
        p+=exc(Math.PI-ang,0,0.35)+exc(fw,0.40,0.85)+exc(lat,0,0.20)+exc(Math.abs(ry),0,0.08)+exc(gS[1],0,0.15)+exc(gT[1],0,0.15)+kneesUp(gT)+kneesUp(gS)+sitPen(gT,PT,0.5)+sitPen(gS,PS,0.5);
        break;
    case 'facingWrap': { // 跨坐在对方大腿上，双腿张开从左右夹住躯干般相对
        const ph=PS.hip, hw=PS[0].e[0], gp=hw+0.03;
        p+=exc(Math.PI-ang,0,0.35)+exc(fw,0.0,0.20)+exc(lat,0,0.10)+exc(ry,0.06,0.35)+exc(gS[1],0,0.12)
          +exc(gT[10],0.5,9)+exc(gT[14],0.5,9)+exc(gT[12],0.5,9)+exc(gT[16],0.5,9)+sitPen(gT,PT,0.6)+sitPen(gS,PS,0.5);
        for(const k of [6,8]){
            const c=PT[k].c, dx=c[0]-ph[0], dz=c[2]-ph[2];
            p+=exc(Math.abs(dx*fS[1]-dz*fS[0]),hw+0.04,9)+exc(dx*fS[0]+dz*fS[1],-9,0.1);
        }
        // 左右两条腿要分在对方躯干的“两侧”（不能偏向一侧）
        const l6=latOf(ph,fS,PT[6].c), l8=latOf(ph,fS,PT[8].c);
        p+=exc(l6*l8,-9,-gp*gp);
        // 膝盖・小腿也位于躯干外侧，并绕到对方腰部后方
        for(const k of [7,9]){
            p+=exc(Math.abs(latOf(ph,fS,PT[k].c)),hw+0.02,9);
        }
        for(const k of [6,8]){
            p+=exc(Math.abs(latOf(ph,fS,kneePt(PT,k))),hw+0.04,9);
        }
        for(const f of PT.feet){
            const dx=f[0]-ph[0], dz=f[2]-ph[2];
            p+=exc(dx*fS[0]+dz*fS[1],-9,0.08);
        }
        break; }
    case 'overAllFours': { // T＝仰躺的人／S＝在其上方、手与膝撑地的四肢着地俯身覆盖者（头在同一侧・脸相对）
        const aT=PT[0].a, aS=PS[0].a, cT=PT[0].c, cS=PS[0].c;
        const lT=Math.hypot(aT[3],aT[5])||1, lS=Math.hypot(aS[3],aS[5])||1;
        const dot=(aT[3]*aS[3]+aT[5]*aS[5])/(lT*lS);
        const ux=aT[3]/lT, uz=aT[5]/lT, wT=PT[0].e[0];
        const cx=cS[0]-cT[0], cz=cS[2]-cT[2], cy=cS[1]-cT[1];
        p+=exc(Math.abs(aT[4]),0,0.3)+exc(aT[7],0.7,1)+exc(Math.abs(aS[4]),0,0.45)+exc(-aS[7],0.55,1)+exc(dot,0.6,1)
          +exc(cy,0.22,0.8)+exc(Math.hypot(cx,cz),0,0.28);
        // 膝盖撑地，从左右跨过仰躺者的腰部
        const kl=kneePt(PS,6), kr=kneePt(PS,8);
        p+=exc(kl[1],-9,0.1)+exc(kr[1],-9,0.1);
        const l1=(kl[0]-cT[0])*uz-(kl[2]-cT[2])*ux, l2=(kr[0]-cT[0])*uz-(kr[2]-cT[2])*ux;
        p+=exc(l1*l2,-9,-(wT/2+0.03)*(wT/2+0.03))+exc(Math.abs(l1),wT/2+0.02,9)+exc(Math.abs(l2),wT/2+0.02,9);
        p+=exc(gS[10],0.05,9)+exc(gS[14],0.05,9);
        break; }
    case 'reverseStack': { // 两人都仰躺，头脚方向相反上下叠着躺（T 在上）
        const aT=PT[0].a, aS=PS[0].a, cT=PT[0].c, cS=PS[0].c;
        const lT=Math.hypot(aT[3],aT[5])||1, lS=Math.hypot(aS[3],aS[5])||1;
        const dot=(aT[3]*aS[3]+aT[5]*aS[5])/(lT*lS);
        const cx=cT[0]-cS[0], cz=cT[2]-cS[2], cy=cT[1]-cS[1];
        p+=exc(Math.abs(aT[4]),0,0.3)+exc(aT[7],0.7,1)+exc(Math.abs(aS[4]),0,0.3)+exc(aS[7],0.7,1)+exc(dot,-1,-0.6)
          +exc(cy,0.08,0.45)+exc(Math.hypot(cx,cz),0,0.3)
          +exc(gT[9],1.0,9)+exc(gT[13],1.0,9)+exc(gT[12],0.8,9)+exc(gT[16],0.8,9);
        break; }
    case 'overAllFoursWide': // 四肢着地：大幅张开双腿，膝盖撑在仰躺者躯干两侧（头在同一侧）
        p+=allFoursPen(gT,gS,PT,PS,'wide');
        break;
    case 'overAllFoursOff': // 四肢着地：脸与脸不重叠（覆盖者的脸落在对方躯干与腿交界处上方）
        p+=allFoursPen(gT,gS,PT,PS,'off');
        break;
    case 'reverseStackWide': { // 反向叠着躺：上方的人张开双腿，用双腿夹住并跨过下方人的躯干
        const aT=PT[0].a, aS=PS[0].a, cT=PT[0].c, cS=PS[0].c;
        const lT=Math.hypot(aT[3],aT[5])||1, lS=Math.hypot(aS[3],aS[5])||1;
        const dot=(aT[3]*aS[3]+aT[5]*aS[5])/(lT*lS);
        const cx=cT[0]-cS[0], cz=cT[2]-cS[2], cy=cT[1]-cS[1];
        const ux=aS[3]/lS, uz=aS[5]/lS, hw=PS[0].e[0]+0.03;
        p+=exc(Math.abs(aT[4]),0,0.3)+exc(aT[7],0.7,1)+exc(Math.abs(aS[4]),0,0.3)+exc(aS[7],0.7,1)+exc(dot,-1,-0.6)
          +exc(cy,0.08,0.5)+exc(Math.hypot(cx,cz),0,0.45)
          +exc(gT[10],0.4,9)+exc(gT[14],0.4,9)+exc(gT[9],-0.5,1.0)+exc(gT[13],-0.5,1.0)+exc(gT[12],0,1.6)+exc(gT[16],0,1.6);
        const ls=[];
        for(const k of [6,8]){
            const c=PT[k].c, dx=c[0]-cS[0], dz=c[2]-cS[2];
            const lat=dx*uz-dz*ux, lon=dx*ux+dz*uz;
            ls.push(lat);
            p+=exc(Math.abs(lat),hw,9)+exc(Math.abs(lon),0,PS[0].e[1]+0.1);
        }
        p+=exc(ls[0]*ls[1],-9,-hw*hw);
        break; }
    case 'standFace': // 站立相对
        p+=exc(Math.PI-ang,0,0.3)+exc(fw,0.05,0.45)+exc(lat,0,0.12)+standPen(gT,PT,0.25)+standPen(gS,PS,0.25);
        break;
    case 'standBack': // 前后重叠、朝同一方向站立
        p+=exc(ang,0,0.3)+exc(fw,0.05,0.40)+exc(lat,0,0.10)+standPen(gT,PT,0.25)+standPen(gS,PS,0.25);
        break;
    case 'standSide': // 并排朝同一方向站立
        p+=exc(ang,0,0.35)+exc(Math.abs(fw),0,0.15)+exc(lat,0.15,0.60)+standPen(gT,PT,0.25)+standPen(gS,PS,0.25);
        break;
    case 'cradle': { // 侧坐在大腿上，把上身靠在对方身上
        const hT=PT[1].c, ph=PT.hip;
        const toward=-((hT[0]-ph[0])*fS[0]+(hT[2]-ph[2])*fS[1]); // 头部是否靠近支撑者的躯干侧
        p+=exc(Math.abs(ang-Math.PI/2),0,0.35)+exc(fw,0.06,0.36)+exc(lat,0,0.14)+exc(ry,0.08,0.35)
          +exc(toward,0.04,9)+exc(torsoTilt(PT),0.15,1.0)+sitPen(gS,PS,0.5);
        break; }
    case 'side': // 并排朝同一方向坐下
        p+=exc(ang,0,0.4)+exc(Math.abs(ry),0,0.07)+exc(Math.abs(fw),0,0.12)+exc(lat,0.10,0.50)+sitPen(gT,PT,0.45)+sitPen(gS,PS,0.45);
        break;
    case 'lying': { // 躺卧：T 横躺／支撑者坐着接住，或同样躺下
        const uT=Math.abs(PT[0].a[4]), uS=Math.abs(PS[0].a[4]);
        p+=2*exc(uT,0,0.35)+Math.max(0,Math.min(uS-0.35,0.8-uS))+exc(Math.hypot(rx,rz),0,0.6);
        if(uS>=0.6) p+=sitPen(gS,PS,0.5);
        break; }
    }
    return p;
}
function tilt(P){
    const a=P[0].a; // 躯干的局部 Y 轴
    const c=a[4]; // y 分量（1＝直立）
    return (1-Math.abs(c));
}
function gazeExcess(P,Q){
    // P 的头看向 Q 的头所需的颈部旋转量（躯干坐标）
    const inv=qInv(P.Rt);
    const hp=P[1].c, tq=Q[1].c;
    const v=qRot(inv,[tq[0]-hp[0],tq[1]-hp[1],tq[2]-hp[2]]);
    const l=Math.hypot(v[0],v[1],v[2])||1;
    const yaw=Math.atan2(v[0],v[2]); const pitch=Math.asin(clampN(v[1]/l,-1,1));
    let e=0;
    if(Math.abs(yaw)>1.2) e+=Math.abs(yaw)-1.2;
    if(pitch<-0.9) e+=-0.9-pitch;
    if(pitch>0.8) e+=pitch-0.8;
    return e;
}
function comfort(g){
    let c=0;
    // 越接近关节活动极限，姿势越勉强
    const soft=(v,lo,hi,m)=>{ if(v>hi-m) c+=(v-(hi-m))/m; if(v<lo+m) c+=((lo+m)-v)/m; };
    soft(g[6],G_LO[6],G_HI[6],0.3);
    soft(g[7],G_LO[7],G_HI[7],0.15); soft(g[8],G_LO[8],G_HI[8],0.25);
    for(let i=0;i<2;i++){const o=9+i*4;
        soft(g[o],G_LO[o],G_HI[o],0.3); soft(g[o+1],G_LO[o+1],G_HI[o+1],0.2);
        soft(g[o+2],G_LO[o+2],G_HI[o+2],0.3); soft(g[o+3],G_LO[o+3],G_HI[o+3],0.25);
    }
    // 左右腿的差异不要过大
    c+=0.15*Math.abs(g[9]-g[13]);
    return c*0.3;
}
const DEF_W={viol:120,grav:0.5,contact:3,face:1.2,gaze:0.5,comfort:0.4,tilt:0.35,vol:2.2,fam:8,space:1.2,center:1.0,foot:30};

// ================= 初始姿势（姿势模板） ==================
function sitGene(d,o){
    const g=new Float64Array(GN);
    g[0]=o.x||0; g[1]=(o.y!==undefined)?o.y:d.legT/2+0.01; g[2]=o.z||0; g[3]=o.yaw||0; g[4]=o.pitch||0; g[5]=o.roll||0;
    g[6]=o.lean||0; g[7]=o.side||0; g[8]=o.twist||0;
    const L=o.legs||{};
    const f=L.flex!==undefined?L.flex:1.45, ab=L.abd!==undefined?L.abd:0.15, ex=L.ext||0, kn=L.knee!==undefined?L.knee:0.2;
    g[9]=f;g[10]=ab;g[11]=ex;g[12]=kn; g[13]=(L.flexR!==undefined?L.flexR:f);g[14]=ab;g[15]=ex;g[16]=(L.kneeR!==undefined?L.kneeR:kn);
    return g;
}
const FAMILIES=['between','betweenF','laplap','laplapF','facingKnees','facingWrap','cradle','side','lying','overAllFours','overAllFoursWide','overAllFoursOff','reverseStack','reverseStackWide'];
const STAND_FAMS=['standFace','standBack','standSide']; // 清洁柜（站立）使用的姿势
const SYM_FAMS={side:1,facingKnees:1,standFace:1,standSide:1}; // 不区分角色（上方／支撑）的类型
function familySeeds(dA,dB,fam){
    const out=[]; // [gA,gB]
    const sB=dB.legT/2+0.01, sA=dA.legT/2+0.01;
    if(fam==='between'){
        // 支撑者（B 侧）双膝打开，A 坐在中间的地面上
        out.push([sitGene(dA,{z:dB.torsoD/2+dA.torsoD/2+0.14,lean:-0.12,legs:{flex:1.45,abd:0.1,knee:0.2}}),
                  sitGene(dB,{lean:0.05,legs:{flex:1.3,abd:0.65,knee:0.3}})]);
        out.push([sitGene(dA,{z:0.3,lean:-0.12,legs:{flex:1.7,abd:0.1,knee:1.9}}),
                  sitGene(dB,{lean:0.1,legs:{flex:1.9,abd:0.6,knee:1.9}})]);
    } else if(fam==='laplap'){
        out.push([sitGene(dA,{z:0.3,y:sB+dB.legT/2+dA.legT/2+0.02,lean:-0.1,legs:{flex:1.2,abd:0.1,knee:1.0}}),
                  sitGene(dB,{lean:0.05,legs:{flex:1.45,abd:0.1,knee:0.15}})]);
        out.push([sitGene(dA,{z:0.2,y:sB+dB.legT*0.7,lean:-0.2,legs:{flex:1.6,abd:0.1,knee:1.6}}),
                  sitGene(dB,{lean:0.1,legs:{flex:1.3,abd:0.4,knee:0.9}})]);
    } else if(fam==='betweenF'){
        out.push([sitGene(dA,{z:0.42,yaw:PI,lean:0.1,legs:{flex:1.5,abd:0.5,knee:0.5}}),
                  sitGene(dB,{lean:0.05,legs:{flex:1.4,abd:0.7,knee:0.3}})]);
        out.push([sitGene(dA,{z:0.4,yaw:PI,lean:0.1,legs:{flex:1.9,abd:0.3,knee:2.0}}),
                  sitGene(dB,{lean:0.05,legs:{flex:1.9,abd:0.6,knee:1.9}})]);
    } else if(fam==='facingKnees'){
        out.push([sitGene(dA,{z:0.62,yaw:PI,lean:0.1,legs:{flex:1.9,abd:0.12,knee:2.3}}),
                  sitGene(dB,{lean:0.1,legs:{flex:1.9,abd:0.12,knee:2.3}})]);
        out.push([sitGene(dA,{x:0.1,z:0.58,yaw:PI,lean:0.15,legs:{flex:1.9,abd:0.2,knee:2.3}}),
                  sitGene(dB,{lean:0.15,legs:{flex:1.9,abd:0.2,knee:2.3}})]);
    } else if(fam==='facingWrap'){
        out.push([sitGene(dA,{z:0.12,y:sB+dB.legT/2+dA.legT/2+0.02,yaw:PI,lean:0.1,legs:{flex:1.3,abd:0.8,knee:1.0}}),
                  sitGene(dB,{lean:0.05,legs:{flex:1.45,abd:0.15,knee:0.15}})]);
        out.push([sitGene(dA,{z:0.15,y:sB+dB.legT/2+dA.legT/2+0.02,yaw:PI,lean:0.05,legs:{flex:1.5,abd:0.9,knee:1.4}}),
                  sitGene(dB,{lean:0.05,legs:{flex:1.3,abd:0.3,knee:1.8}})]);
    } else if(fam==='laplapF'){
        out.push([sitGene(dA,{z:0.22,y:sB+dB.legT/2+dA.legT/2+0.02,yaw:PI,lean:0.1,legs:{flex:1.5,abd:0.7,knee:1.0}}),
                  sitGene(dB,{lean:0.1,legs:{flex:1.45,abd:0.15,knee:0.15}})]);
        out.push([sitGene(dA,{z:0.25,y:sB+0.05,yaw:PI,lean:0.05,legs:{flex:1.3,abd:0.8,knee:1.4}}),
                  sitGene(dB,{lean:0.05,legs:{flex:0.9,abd:0.8,knee:2.1,ext:0.3}})]);
    } else if(fam==='cradle'){
        out.push([sitGene(dA,{x:0.0,z:0.2,y:sB+dB.legT/2+dA.legT/2+0.02,yaw:PI/2,lean:-0.3,side:0.2,legs:{flex:1.3,abd:0.05,knee:1.2}}),
                  sitGene(dB,{lean:0.25,legs:{flex:1.45,abd:0.1,knee:0.2}})]);
        out.push([sitGene(dA,{x:0.0,z:0.2,y:sB+dB.legT*0.8,yaw:-PI/2,lean:-0.3,side:-0.2,legs:{flex:1.3,abd:0.05,knee:1.2}}),
                  sitGene(dB,{lean:0.25,legs:{flex:1.45,abd:0.1,knee:0.2}})]);
    } else if(fam==='side'){
        out.push([sitGene(dA,{x:-0.2,lean:0.35,legs:{flex:1.7,abd:0.1,knee:1.9}}),
                  sitGene(dB,{x:0.2,lean:0.3,legs:{flex:1.7,abd:0.1,knee:1.9}})]);
        out.push([sitGene(dA,{x:-0.22,lean:0.2,legs:{flex:1.45,abd:0.1,knee:0.2}}),
                  sitGene(dB,{x:0.22,lean:0.2,legs:{flex:1.45,abd:0.1,knee:0.2}})]);
    } else if(fam==='overAllFours'){
        // 第一个人＝仰躺，第二个人＝在其上方四肢着地
        for(const sg of [1,-1]){
            out.push([sitGene(dA,{y:dA.torsoD/2+0.03,yaw:sg>0?0:PI,pitch:-1.45*sg,legs:{flex:0.2,abd:0.05,knee:0.1}}),
                      sitGene(dB,{y:0.42,z:0.05*sg,yaw:sg>0?PI:0,pitch:1.35*sg,legs:{flex:1.45,abd:0.25,knee:1.5}})]);
        }
        out.push([sitGene(dA,{y:dA.torsoD/2+0.03,pitch:-1.45,legs:{flex:0.6,abd:0.1,knee:1.0}}),
                  sitGene(dB,{y:0.45,z:0.1,yaw:PI,pitch:1.25,legs:{flex:1.3,abd:0.4,knee:1.6}})]);
    } else if(fam==='overAllFoursWide'){
        for(const sg of [1,-1]){
            out.push([sitGene(dA,{y:dA.torsoD/2+0.03,yaw:sg>0?0:PI,pitch:-1.45*sg,legs:{flex:0.2,abd:0.05,knee:0.1}}),
                      sitGene(dB,{y:0.45,z:0.05*sg,yaw:sg>0?PI:0,pitch:1.35*sg,legs:{flex:1.3,abd:0.6,knee:1.4}})]);
        }
    } else if(fam==='overAllFoursOff'){
        for(const sg of [1,-1]){
            // 头脚方向相反（A 的头位于 B 躯干与腿交界处，B 的头位于 A 躯干与腿交界处）
            out.push([sitGene(dA,{y:dA.torsoD/2+0.03,yaw:sg>0?0:PI,pitch:-1.45*sg,legs:{flex:0.2,abd:0.05,knee:0.1}}),
                      sitGene(dB,{y:0.42,z:-0.8*sg,yaw:sg>0?0:PI,pitch:1.35,legs:{flex:1.45,abd:0.3,knee:1.5}})]);
        }
    } else if(fam==='reverseStackWide'){
        out.push([sitGene(dA,{y:dB.torsoD+dA.torsoD/2+0.04,z:-0.1,yaw:PI,pitch:-1.45,legs:{flex:0.1,abd:0.6,knee:0.6}}),
                  sitGene(dB,{y:dB.torsoD/2+0.03,pitch:-1.45,legs:{flex:0.3,abd:0.1,knee:0.5}})]);
        out.push([sitGene(dA,{y:dB.torsoD+dA.torsoD/2+0.04,z:-0.05,yaw:PI,pitch:-1.45,legs:{flex:0.4,abd:0.5,knee:1.0}}),
                  sitGene(dB,{y:dB.torsoD/2+0.03,pitch:-1.45,legs:{flex:0.6,abd:0.15,knee:1.0}})]);
    } else if(fam==='reverseStack'){
        out.push([sitGene(dA,{y:dB.torsoD+dA.torsoD/2+0.04,z:-0.6,yaw:PI,pitch:-1.45,legs:{flex:1.3,abd:0.1,knee:1.3}}),
                  sitGene(dB,{y:dB.torsoD/2+0.03,pitch:-1.45,legs:{flex:0.9,abd:0.1,knee:1.0}})]);
        out.push([sitGene(dA,{y:dB.torsoD+dA.torsoD/2+0.04,z:-0.55,yaw:PI,pitch:-1.45,legs:{flex:1.6,abd:0.15,knee:1.8}}),
                  sitGene(dB,{y:dB.torsoD/2+0.03,pitch:-1.45,legs:{flex:1.6,abd:0.15,knee:1.8}})]);
    } else if(fam==='standFace'){
        out.push([sitGene(dA,{y:dA.legH,z:0.16,yaw:PI,legs:{flex:0,abd:0.06,knee:0}}),
                  sitGene(dB,{y:dB.legH,legs:{flex:0,abd:0.06,knee:0}})]);
        out.push([sitGene(dA,{y:dA.legH,z:0.2,yaw:PI,lean:0.05,legs:{flex:0.1,abd:0.12,knee:0.1}}),
                  sitGene(dB,{y:dB.legH,lean:0.05,legs:{flex:0.1,abd:0.12,knee:0.1}})]);
    } else if(fam==='standBack'){
        out.push([sitGene(dA,{y:dA.legH,z:0.15,legs:{flex:0,abd:0.06,knee:0}}),
                  sitGene(dB,{y:dB.legH,legs:{flex:0,abd:0.06,knee:0}})]);
        out.push([sitGene(dA,{y:dA.legH,z:0.2,lean:0.05,legs:{flex:0.1,abd:0.1,knee:0.1}}),
                  sitGene(dB,{y:dB.legH,lean:0.05,legs:{flex:0.1,abd:0.1,knee:0.1}})]);
    } else if(fam==='standSide'){
        out.push([sitGene(dA,{y:dA.legH,x:-0.14,legs:{flex:0,abd:0.06,knee:0}}),
                  sitGene(dB,{y:dB.legH,x:0.14,legs:{flex:0,abd:0.06,knee:0}})]);
        out.push([sitGene(dA,{y:dA.legH,x:-0.18,legs:{flex:0.05,abd:0.1,knee:0.05}}),
                  sitGene(dB,{y:dB.legH,x:0.18,legs:{flex:0.05,abd:0.1,knee:0.05}})]);
    } else if(fam==='lying'){
        for(const sg of [1,-1]){
            out.push([sitGene(dA,{x:0,z:0.25,y:sB+dB.legT/2+dA.torsoD/2+0.03,yaw:sg*PI/2,pitch:-1.45,legs:{flex:0.3,abd:0.05,knee:1.2}}),
                      sitGene(dB,{lean:0.3,legs:{flex:1.45,abd:0.1,knee:0.2}})]);
        }
        out.push([sitGene(dA,{x:0,z:0.05,y:dA.torsoD/2+0.02,yaw:0,pitch:-1.5,legs:{flex:0.3,abd:0.05,knee:0.9}}),
                  sitGene(dB,{x:0,z:0.0,y:dB.torsoD/2+0.2,yaw:0,pitch:-1.5,legs:{flex:0.3,abd:0.05,knee:0.9}})]);
    }
    if(STAND_FAMS.indexOf(fam)>=0){ // 为防身高装不进箱子，也准备了蹲下的样本
        const n=out.length;
        for(let k=0;k<n;k++){
            const ca=Float64Array.from(out[k][0]), cb=Float64Array.from(out[k][1]);
            for(const w of [[ca,dA],[cb,dB]]){ const g=w[0], d=w[1]; g[9]=g[13]=1.1; g[12]=g[16]=1.9; g[6]=0.4; g[1]=d.legHalf*(Math.cos(1.1)+Math.cos(0.8))+0.02; }
            out.push([ca,cb]);
        }
    }
    return out;
}
function rotateSeed(g,th){
    const o=Float64Array.from(g);
    const c=Math.cos(th),s=Math.sin(th);
    o[0]=g[0]*c+g[2]*s; o[2]=-g[0]*s+g[2]*c; o[3]=g[3]+th;
    return o;
}
function recenterPair(gA,gB){
    const cx=(gA[0]+gB[0])/2, cz=(gA[2]+gB[2])/2;
    gA[0]-=cx;gB[0]-=cx;gA[2]-=cz;gB[2]-=cz;
}

// ================= 搜索（模拟退火） ==================
function clampGene(ctx,g){
    for(let i=0;i<GN;i++){ if(i===3) continue; g[i]=clampN(g[i],G_LO[i],G_HI[i]); }
    const b=ctx.box;
    if(b.auto){ g[0]=clampN(g[0],-1.2,1.2); g[2]=clampN(g[2],-1.2,1.2); g[1]=clampN(g[1],0,1.6); }
    else { g[0]=clampN(g[0],-b.W/2,b.W/2); g[2]=clampN(g[2],-b.D/2,b.D/2); g[1]=clampN(g[1],0,b.H); }
}
function* anneal(ctx,gA,gB,aA,aB,nEval,rnd,T0,T1,useArms,scale0,ramp){
    let cur=evalPose(ctx,gA,aA,gB,aB,useArms);
    let bestJ=cur.J,bestA=Float64Array.from(gA),bestB=Float64Array.from(gB),bestInfo=cur;
    let cA=Float64Array.from(gA),cB=Float64Array.from(gB);
    for(let it=0;it<nEval;it++){
        const fr=it/nEval;
        const T=T0*Math.pow(T1/T0,fr);
        const sc=(scale0||1)*(1-0.85*fr);
        // 前期弱化干涉、大幅调整布局，后期再逐步消除干涉
        const vw=ramp?cur.W*(0.15+0.85*Math.min(1,fr/0.55)):cur.W;
        const nA=Float64Array.from(cA),nB=Float64Array.from(cB);
        const r=rnd();
        if(r<0.45){
            const k=1+Math.floor(rnd()*4);
            for(let m=0;m<k;m++){
                const i=Math.floor(rnd()*GN*2); const t=i<GN?nA:nB; const j=i%GN;
                if(j===1&&rnd()<0.5) continue;
                t[j]+=gauss(rnd)*G_SIG[j]*sc;
            }
        } else if(r<0.62){
            const t=rnd()<0.5?nA:nB; t[0]+=gauss(rnd)*0.05*sc; t[2]+=gauss(rnd)*0.05*sc; t[1]+=gauss(rnd)*0.03*sc;
        } else if(r<0.70){
            const dx=gauss(rnd)*0.05*sc,dz=gauss(rnd)*0.05*sc; nA[0]+=dx;nB[0]+=dx;nA[2]+=dz;nB[2]+=dz;
        } else if(r<0.78){
            const t=rnd()<0.5?nA:nB; t[3]+=gauss(rnd)*0.3*sc;
        } else if(r<0.90){
            const t=rnd()<0.5?nA:nB; const j=[0,1,3][Math.floor(rnd()*3)]; // 双腿一起移动
            const o=[9,10,11,12][j===3?3:j]; const dv=gauss(rnd)*G_SIG[o]*sc;
            t[9+j]+=dv; t[13+j]+=dv;
        } else {
            const t=rnd()<0.5?nA:nB; t[6]+=gauss(rnd)*0.15*sc; t[4]+=gauss(rnd)*0.12*sc; t[1]+=gauss(rnd)*0.03*sc;
        }
        clampGene(ctx,nA);clampGene(ctx,nB);
        const e=evalPose(ctx,nA,aA,nB,aB,useArms);
        const dJ=(vw*e.viol+e.Qf)-(vw*cur.viol+cur.Qf);
        if(dJ<=0||rnd()<Math.exp(-dJ/T)){
            cur=e;cA=nA;cB=nB;
            if(e.J<bestJ){bestJ=e.J;bestA=Float64Array.from(nA);bestB=Float64Array.from(nB);bestInfo=e;}
        }
        if((it&31)===31) yield 0;
    }
    return {gA:bestA,gB:bestB,info:bestInfo};
}
// 让其垂直落下接地（在不增加陷入的前提下尽量贴合）
function settleDown(ctx,gA,aA,gB,aB,who,useArms){
    const base=evalPose(ctx,gA,aA,gB,aB,useArms);
    const g=who===0?gA:gB;
    const y0=g[1];
    const ok=(dy)=>{ g[1]=Math.max(0,y0-dy); const e=evalPose(ctx,gA,aA,gB,aB,useArms); return e.viol<=base.viol+1e-4; };
    let lo=0,hi=Math.min(y0,0.8);
    if(ok(hi)){ g[1]=Math.max(0,y0-hi); return; }
    for(let i=0;i<14;i++){ const mid=(lo+hi)/2; if(ok(mid)) lo=mid; else hi=mid; }
    g[1]=Math.max(0,y0-lo);
}

// ================= 手臂的搜索 ==================
function armCost(ctx,who,P,Q,i,W){
    // 评估 who 的第 i 条手臂（0 左/1 右）：与他人・自己・箱子的干涉＋拥抱程度
    const a0=2+i*2,a1=3+i*2;
    let pen=0;
    for(let k=0;k<10;k++){ pen+=pairDepth(P[a0],Q[k]); pen+=pairDepth(P[a1],Q[k]); }
    for(let k=0;k<SELF_PAIRS.length;k++){
        const pr=SELF_PAIRS[k];
        if(pr[0]===a0||pr[0]===a1||pr[1]===a0||pr[1]===a1){
            const v=pairDepth(P[pr[0]],P[pr[1]])-pr[2]; if(v>0) pen+=v;
        }
    }
    pen+=boxViol(ctx,P,[a0,a1],null);
    const H=P.hands[i];
    const Pt=Q[0], My=P[0];
    const dP=pointObbDist(H,Pt);
    let dS=1e9;
    for(let k=6;k<10;k++){const v=pointObbDist(H,P[k]); if(v<dS) dS=v;}
    const dT=pointObbDist(H,My);
    let dQ=1e9;
    for(let k=6;k<10;k++){const v=pointObbDist(H,Q[k]); if(v<dQ) dQ=v;} // 对方的腿部（把手放在膝盖・大腿上）
    let att=Math.min(dP,dS+0.05,dT+0.08,dQ+0.04);
    // 绕到对方另一侧（搂抱）的加分项
    let bonus=0;
    const dx=Pt.c[0]-My.c[0],dy=Pt.c[1]-My.c[1],dz=Pt.c[2]-My.c[2]; const dl=Math.hypot(dx,dy,dz)||1;
    const behind=((H[0]-Pt.c[0])*dx+(H[1]-Pt.c[1])*dy+(H[2]-Pt.c[2])*dz)/dl;
    if(behind>0.01&&dP<0.05) bonus=-0.25;
    // 四肢着地的人要把手撑在地面上
    const floorPull=(ctx.fp&&ALLFOURS_FAMS[ctx.fp.fam]&&who===(ctx.fp.top?0:1))?8*Math.max(0,H[1]):0;
    return W.viol*pen+5*att+bonus+floorPull;
}
function armComfort(a,i){
    const o=i*4; const f=a[o],ab=a[o+1],r=a[o+2],e=a[o+3];
    let c=0;
    if(f>1.4) c+=0.15*(f-1.4);
    if(ab>1.5) c+=0.15*(ab-1.5);
    if(f<-0.3) c+=0.3*(-0.3-f);
    if(e>2.2) c+=0.5*(e-2.2);
    c+=0.04*Math.abs(r);
    return c;
}
function* solveArms(ctx,gA,gB,aA,aB,rnd,nRand,nHill){
    const order=[[1,0],[1,1],[0,0],[0,1],[1,0],[1,1],[0,0],[0,1]];
    for(let pass=0;pass<order.length;pass++){
        const who=order[pass][0], i=order[pass][1];
        const g=who===0?gA:gB, d=who===0?ctx.dA:ctx.dB, a=who===0?aA:aB;
        const gq=who===0?gB:gA, dq=who===0?ctx.dB:ctx.dA, aq=who===0?aB:aA;
        const Q=buildBody(dq,gq,aq,ctx.ana);
        const o=i*4;
        const score=(arm)=>{
            const P=buildBody(d,g,arm,ctx.ana);
            return armCost(ctx,who,P,Q,i,ctx.W)+armComfort(arm,i);
        };
        let best=Float64Array.from(a), bestC=score(best);
        const consider=(arm)=>{const c=score(arm); if(c<bestC){bestC=c;best=arm;}};
        if(pass<4){
            consider(Float64Array.from(ARM_NEUTRAL));
            for(let n=0;n<nRand;n++){
                const arm=Float64Array.from(a);
                for(let k=0;k<4;k++) arm[o+k]=A_LO[k]+rnd()*(A_HI[k]-A_LO[k]);
                consider(arm);
                if((n&31)===31) yield 0;
            }
        }
        for(let n=0;n<nHill;n++){
            const arm=Float64Array.from(best);
            const sc=0.4*(1-n/nHill)+0.04;
            const k=1+Math.floor(rnd()*3);
            for(let m=0;m<k;m++){const q=Math.floor(rnd()*4); arm[o+q]=clampN(arm[o+q]+gauss(rnd)*0.35*sc,A_LO[q],A_HI[q]);}
            consider(arm);
            if((n&31)===31) yield 0;
        }
        for(let k=0;k<8;k++) a[k]=best[k];
    }
}

// ================= 整体流程 ==================
function makeCtx(o){
    const dA=makeDims(o.heightA,o.genderA), dB=makeDims(o.heightB,o.genderB);
    return {dA,dB,box:o.box,wA:bodyVolWeights(dA),wB:bodyVolWeights(dB),W:Object.assign({},DEF_W,o.weights||{})};
}
function famRoleSeeds(ctx,fam){
    // 准备“谁坐上方（前方）”的两种组合
    const out=[];
    for(const s of familySeeds(ctx.dA,ctx.dB,fam)) out.push({gA:s[0],gB:s[1],top:0});
    if(!SYM_FAMS[fam]){
        for(const s of familySeeds(ctx.dB,ctx.dA,fam)) out.push({gA:s[1],gB:s[0],top:1});
    }
    return out;
}
function* solveGen(o){
    const ctx=makeCtx(o);
    const rnd=mulberry32((o.seed||1)*2654435761>>>0);
    const aA=Float64Array.from(ARM_NEUTRAL), aB=Float64Array.from(ARM_NEUTRAL);
    const fams=(o.family&&o.family!=='auto')?[o.family]:(o.box.locker?STAND_FAMS:FAMILIES);
    // 高个子压在矮个子身上不自然，因此略微扣分
    const roleBias=(c)=>{
        if(SYM_FAMS[c.fam]) return 0;
        const hT=c.top?ctx.dB.h:ctx.dA.h, hS=c.top?ctx.dA.h:ctx.dB.h;
        return 20*Math.max(0,hT/hS-0.98)+(c.top?0.02:0);
    };
    const avoidPen=(c)=>((o.avoidFam&&c.fam===o.avoidFam)?0.8:0)+roleBias(c);
    // 1) 对模板×角色×朝向的初始姿势全部打分
    let cands=[];
    for(const fam of fams){
        const seeds=famRoleSeeds(ctx,fam);
        for(let si=0;si<seeds.length;si++){
            // 模板原型，以及略微抖动关节・位置的变体（用于取得好的起点）
            for(let jt=0;jt<(o.nJit||8);jt++){
                let bA=seeds[si].gA, bB=seeds[si].gB;
                if(jt>0){
                    bA=Float64Array.from(bA); bB=Float64Array.from(bB);
                    for(const t of [bA,bB]){
                        for(let i=4;i<GN;i++) t[i]+=gauss(rnd)*G_SIG[i]*0.8;
                        t[0]+=gauss(rnd)*0.04; t[2]+=gauss(rnd)*0.04;
                        t[13]=t[9]; t[14]=t[10]; t[15]=t[11]; t[16]=t[12]; // 从左右对齐的状态开始
                    }
                }
                for(let k=0;k<4;k++){
                    const th=k*PI/2;
                    const gA=rotateSeed(bA,th), gB=rotateSeed(bB,th);
                    recenterPair(gA,gB);
                    clampGene(ctx,gA);clampGene(ctx,gB);
                    setFp(ctx,{fam:fam,top:seeds[si].top});
                    const e=evalPose(ctx,gA,aA,gB,aB,false);
                    cands.push({fam,top:seeds[si].top,gA,gB,J:e.J});
                }
            }
        }
        yield 0;
    }
    cands.sort((p,q)=>(p.J+avoidPen(p))-(q.J+avoidPen(q)));
    // 按模板×角色各取一个最佳起点（保证任何角色都能搜索）→ 不足时用总排名靠前的补齐
    const picked=[]; const seen={};
    for(const c of cands){ const key=c.fam+c.top; if(!seen[key]){seen[key]=1;picked.push(c);} }
    if(!o.scanOnly) for(const c of cands){ if(picked.length>=(o.nStart||6)) break; if(picked.indexOf(c)<0) picked.push(c); }
    picked.sort((p,q)=>(p.J+avoidPen(p))-(q.J+avoidPen(q)));
    const starts=picked;
    // 2) 对各自进行模拟退火
    const results=[];
    const nEval=o.evals||1400;
    for(const s of starts){
        setFp(ctx,{fam:s.fam,top:s.top});
        let r=yield* anneal(ctx,s.gA,s.gB,aA,aB,nEval,rnd,0.5,0.02,false,1,true);
        if(r.info.fpen>0.03){ // 若未能保持模板，就从该姿势重新再搜一次
            const r2=yield* anneal(ctx,r.gA,r.gB,aA,aB,nEval,rnd,0.35,0.02,false,0.8,true);
            if(r2.info.J<r.info.J) r=r2;
        }
        results.push({fam:s.fam,top:s.top,gA:r.gA,gB:r.gB,J:r.info.J,viol:r.info.viol,pv:r.info.pv,fpen:r.info.fpen});
    }
    if(o.scanOnly){
        // 仅检查各姿势能否做出“无干涉・符合模板”的姿态（不成立的模板会再仔细搜索一次）
        const scan={};
        for(const f of fams) scan[f]={ok:false,pv:9,fpen:9};
        const isOk=(pv,fp)=>pv<=0.008&&fp<=0.15;
        const note=(r)=>{
            const ok=isOk(r.pv,r.fpen), cur=scan[r.fam];
            if(ok||(!cur.ok&&(r.pv+r.fpen)<(cur.pv+cur.fpen))) scan[r.fam]={ok:cur.ok||ok,pv:r.pv,fpen:r.fpen};
        };
        for(const r of results) note(r);
        for(const r of results){
            for(let retry=0;retry<7&&!scan[r.fam].ok;retry++){ // 不成立的模板最多重新搜索 7 次
                setFp(ctx,{fam:r.fam,top:r.top});
                let sA=r.gA, sB=r.gB;
                if(retry>=3){ // 若在同一起点找不到，则从抖动姿势后的其它起点重新搜索
                    const sd=famRoleSeeds(ctx,r.fam).filter(x=>x.top===r.top), pk=sd[retry%sd.length];
                    sA=Float64Array.from(pk.gA); sB=Float64Array.from(pk.gB);
                    for(const t of [sA,sB]){
                        for(let i=4;i<GN;i++) t[i]+=gauss(rnd)*G_SIG[i]*0.8;
                        t[13]=t[9]; t[14]=t[10]; t[15]=t[11]; t[16]=t[12];
                    }
                    const th=Math.floor(rnd()*4)*PI/2;
                    sA=rotateSeed(sA,th); sB=rotateSeed(sB,th); recenterPair(sA,sB); clampGene(ctx,sA); clampGene(ctx,sB);
                }
                const r2=yield* anneal(ctx,sA,sB,aA,aB,nEval*2,rnd,0.35,0.02,false,0.8,true);
                note({fam:r.fam,pv:r2.info.pv,fpen:r2.info.fpen});
            }
        }
        return {scan};
    }
    results.sort((p,q)=>(p.J+avoidPen(p))-(q.J+avoidPen(q)));
    // 3) 对靠前的解依次做：接地→手臂→收尾
    let final=null;
    const nTop=Math.min(o.nTop||3,results.length);
    for(let t=0;t<nTop;t++){
        const r=results[t];
        setFp(ctx,{fam:r.fam,top:r.top});
        const gA=Float64Array.from(r.gA),gB=Float64Array.from(r.gB);
        const a1=Float64Array.from(ARM_NEUTRAL),b1=Float64Array.from(ARM_NEUTRAL);
        settleDown(ctx,gA,a1,gB,b1,0,false); settleDown(ctx,gA,a1,gB,b1,1,false);
        yield* solveArms(ctx,gA,gB,a1,b1,rnd,o.armRand||1400,o.armHill||300);
        // 收尾：连同手臂一起微调
        const rr=yield* anneal(ctx,gA,gB,a1,b1,o.polish||500,rnd,0.08,0.01,true,0.35);
        settleDown(ctx,rr.gA,a1,rr.gB,b1,0,true); settleDown(ctx,rr.gA,a1,rr.gB,b1,1,true);
        const e=evalPose(ctx,rr.gA,a1,rr.gB,b1,true);
        const cand={fam:r.fam,top:r.top,ana:ctx.ana,gA:rr.gA,gB:rr.gB,aA:a1,aB:b1,J:e.J,viol:e.viol,info:e};
        if(!final||cand.J+avoidPen(cand)<final.J+avoidPen(final)) final=cand;
        yield 0;
    }
    // 4) 箱子尺寸（自动时为刚好贴合＋留白）
    const e=final.info;
    let box;
    if(ctx.box.auto){
        const pad=0.025;
        const cx=(e.bb.x0+e.bb.x1)/2, cz=(e.bb.z0+e.bb.z1)/2;
        final.gA[0]-=cx;final.gB[0]-=cx;final.gA[2]-=cz;final.gB[2]-=cz;
        box={W:(e.bb.x1-e.bb.x0)+pad*2,D:(e.bb.z1-e.bb.z0)+pad*2,H:e.bb.y1+pad};
    } else {
        // 手动尺寸：两人整体移到箱子中央（只是平移，陷入量不变）
        const cx=(e.bb.x0+e.bb.x1)/2, cz=(e.bb.z0+e.bb.z1)/2;
        final.gA[0]-=cx;final.gB[0]-=cx;final.gA[2]-=cz;final.gB[2]-=cz;
        box={W:ctx.box.W,D:ctx.box.D,H:ctx.box.H};
    }
    box.locker=!!ctx.box.locker;
    final.box=box;
    return final;
}


// ===== 暴露到 window =====
const _exported = {
  // 变量
  scene, camera, renderer, clock,
  personA, personB, walkGroup, boxGroup,
  currentView, carrySide,
  currentBox, box, lidOpen,
  solving, solvingPromise, diceAuto, variantSeed, rerollPending,
  lastResult, lastKey, pendingKey,
  lastScan, scanRun, scanParams, scanDoneKey, solvingLock, currentBoxParams,
  // 常量
  PI, GN, ARM_NEUTRAL, DEF_W, G_SIG,
  FAMILIES, STAND_FAMS, SYM_FAMS,
  ANA_FAMS, ALLFOURS_FAMS, ANA_DIMS,
  FAMILY_NAMES, FAMILY_NAMES_LOCKER,
  // 函数
  init, onWindowResize, swapAB, createMannequin,
  mulberry32, gauss, clampN,
  qMul, qX, qY, qZ, qInv, qRot, qAxes, qAim,
  vAdd, vScale, makeDims,
  limbDirsArm, limbDirsLeg, rootQ, spineQ,
  mkObb, mkSphere, limb, buildBody,
  obbDepth, obbSep, sphereObbDepth, pairDepth, pointObbDist,
  selfPen, bodyVolWeights, evalPose, evalParts, boxViol,
  exc, pFwd, torsoTilt, sitPen, kneesUp, setFp, kneePt, latOf, openKnees,
  standPen, allFoursPen, famPen, tilt, gazeExcess, comfort,
  sitGene, familySeeds, rotateSeed, recenterPair,
  clampGene, settleDown, armCost, armComfort, solveArms,
  anneal, makeCtx, famRoleSeeds, solveGen,
};
Object.assign(window, _exported);

// 同时暴露 hzCore（方便 panel 引用）
window.hzCore = _exported;

})();
