import * as extensionConfig from '../extension.json';
import * as common from './lib/common';


async function get_cursor_pos()
{
    let pos = null;
    const cursor = await eda.pcb_SelectControl.getCurrentMousePosition();
    if (cursor) {
        const prim = await eda.pcb_Document.getPrimitiveAtPoint(cursor.x, cursor.y);
        if (prim && 
            (
                prim.getState_PrimitiveType() === EPCB_PrimitiveType.COMPONENT || //器件
                prim.getState_PrimitiveType() === EPCB_PrimitiveType.IMAGE || //图片
                prim.getState_PrimitiveType() === EPCB_PrimitiveType.PAD || //焊盘
                prim.getState_PrimitiveType() === EPCB_PrimitiveType.VIA || //过孔
                //prim.getState_PrimitiveType() === EPCB_PrimitiveType.STRING || //文本
            (prim.getState_PrimitiveType() === EPCB_PrimitiveType.REGION && (prim as any).layer == EPCB_LayerId.BOARD_OUTLINE) //板框
        )) 
            {
            let id = prim.getState_PrimitiveId();
            //await eda.pcb_SelectControl.clearSelected();
            //await eda.pcb_SelectControl.doSelectPrimitives(id);

            let bbox = await eda.pcb_Primitive.getPrimitivesBBox([id]);
            if (bbox){

                // 计算 cursor 到 bbox 四条边的最短距离，找出最近的那条边
                const distLeft   = Math.abs(cursor.x - bbox.minX);
                const distRight  = Math.abs(cursor.x - bbox.maxX);
                const distTop    = Math.abs(cursor.y - bbox.minY);
                const distBottom = Math.abs(cursor.y - bbox.maxY);

                let nearestEdge = 'left';
                let minDist = distLeft;
                if (distRight < minDist) { nearestEdge = 'right'; minDist = distRight; }
                if (distTop    < minDist) { nearestEdge = 'top';    minDist = distTop; }
                if (distBottom < minDist) { nearestEdge = 'bottom'; minDist = distBottom; }

                let startX = 0, startY = 0, endX = 0, endY = 0;
                switch (nearestEdge) {
                    case 'left':
                        startX = bbox.minX; startY = bbox.minY;
                        endX   = bbox.minX; endY   = bbox.maxY;
                        break;
                    case 'right':
                        startX = bbox.maxX; startY = bbox.minY;
                        endX   = bbox.maxX; endY   = bbox.maxY;
                        break;
                    case 'top':
                        startX = bbox.minX; startY = bbox.minY;
                        endX   = bbox.maxX; endY   = bbox.minY;
                        break;
                    case 'bottom':
                        startX = bbox.minX; startY = bbox.maxY;
                        endX   = bbox.maxX; endY   = bbox.maxY;
                        break;
                }
                pos = {
                    primitiveType : prim.getState_PrimitiveType(),
                    primitiveId : id,
                    nearestEdge : nearestEdge,
                    startX : startX,
                    startY : startY,
                    endX : endX,
                    endY : endY,
                }
            }
        }
    }
    return pos;
}

//闭环检测
function circle_check(srcid: string, endid:string, nearestEdge:string)
{
    //闭环检测
    let nextid = endid;
    while(true)
    {
        if (nextid == srcid){
            return true;
        }
        let found = false;
        for (let item of smart_size.size_data){
            if (item.start_pos.primitiveId == nextid){
                if ((item.start_pos.nearestEdge == "left" || item.start_pos.nearestEdge == "right")
                    && (nearestEdge == "left" || nearestEdge == "right")){
                    nextid = item.end_pos.primitiveId;
                    found = true;
                    break;
                }
                if ((item.start_pos.nearestEdge == "top" || item.start_pos.nearestEdge == "bottom")
                    && (nearestEdge == "top" || nearestEdge == "bottom")){
                    nextid = item.end_pos.primitiveId;
                    found = true;
                    break;
                }
            }
        }
        if (!found){
            break;
        }
    }

    //过定义检测
    for (let item of smart_size.size_data){
        if (item.end_pos.primitiveId == endid){
            if ((item.end_pos.nearestEdge == "left" || item.end_pos.nearestEdge == "right")
                && (nearestEdge == "left" || nearestEdge == "right")){
                return true;
            }
            if ((item.end_pos.nearestEdge == "top" || item.end_pos.nearestEdge == "bottom")
                && (nearestEdge == "top" || nearestEdge == "bottom")){
                return true;
            }
        }
    }
    return false;
}

function is_true_pos(pos1: any, pos2: any)
{
    if (pos1.startX == pos1.endX && pos2.startX == pos2.endX){
        return true;
    }
    if (pos1.startY == pos1.endY && pos2.startY == pos2.endY){
        return true;
    }
    return false;
}

async function calc_offset(size_item: any)
{
    let need_update = false;
    let offset_x = 0;
    let offset_y = 0;
    let item = size_item;

    let dimension = await eda.pcb_PrimitiveDimension.get(item.dimension);
    if (dimension instanceof Array){
        return {
        need_update : need_update,
        offset_x : offset_x,
        offset_y : offset_y,
        };
    }
    if (dimension){
        let cs = await dimension.getState_CoordinateSet();
        let x1 = cs[0];
        let y1 = cs[1];
        let x2 = cs[6];
        let y2 = cs[7];
        let srcBbox = await eda.pcb_Primitive.getPrimitivesBBox([item.start_pos.primitiveId]);
        let dstBbox = await eda.pcb_Primitive.getPrimitivesBBox([item.end_pos.primitiveId]);

        //await eda.sys_Log.add('apply_size_data: ' + item.start_pos.nearestEdge + ' ' + item.end_pos.nearestEdge);
        let dance = await eda.sys_Unit.mmToMil(0.01, 4);
        if (item.start_pos.nearestEdge == "left" && item.end_pos.nearestEdge == "left")
        {
            //await eda.sys_Log.add('>>>: ' + srcBbox.minX + ' ' + dstBbox.minX + ' ' + x1 + ' ' + x2);
            if (Math.abs(dstBbox.minX - srcBbox.minX - (x2 - x1)) > dance){
                need_update = true;
                offset_x = (x2 - x1) - (dstBbox.minX - srcBbox.minX);
                //await eda.sys_Log.add('offset_x: ' + offset_x);
            }
        }
        if (item.start_pos.nearestEdge == "left" && item.end_pos.nearestEdge == "right")
        {
                if (Math.abs(dstBbox.maxX - srcBbox.minX - (x2 - x1)) > dance){
                need_update = true;
                offset_x = (x2 - x1) - (dstBbox.maxX - srcBbox.minX);
                //await eda.sys_Log.add('offset_x: ' + offset_x);
            }
        }
        if (item.start_pos.nearestEdge == "right" && item.end_pos.nearestEdge == "right")
        {
            if (Math.abs(dstBbox.maxX - srcBbox.maxX - (x2 - x1)) > dance){
                need_update = true;
                offset_x = (x2 - x1) - (dstBbox.maxX - srcBbox.maxX);
                //await eda.sys_Log.add('offset_x: ' + offset_x);
            }
        }
        if (item.start_pos.nearestEdge == "right" && item.end_pos.nearestEdge == "left")
        {
            if (Math.abs(dstBbox.minX - srcBbox.maxX - (x2 - x1)) > dance){
                need_update = true;
                offset_x = (x2 - x1) - (dstBbox.minX - srcBbox.maxX);
                //await eda.sys_Log.add('offset_x: ' + offset_x);
            }
        }
        if (item.start_pos.nearestEdge == "top" && item.end_pos.nearestEdge == "top")
        {
            if (Math.abs(dstBbox.minY - srcBbox.minY - (y2 - y1)) > dance){
                need_update = true;
                offset_y = (y2 - y1) - (dstBbox.minY - srcBbox.minY);
                //await eda.sys_Log.add('offset_y: ' + offset_y);
            }
        }
        if (item.start_pos.nearestEdge == "top" && item.end_pos.nearestEdge == "bottom")
        {
            if (Math.abs(dstBbox.maxY - srcBbox.minY - (y2 - y1)) > dance){
                need_update = true;
                offset_y = (y2 - y1) - (dstBbox.maxY - srcBbox.minY);
                //await eda.sys_Log.add('offset_y: ' + offset_y);
            }
        }
        if (item.start_pos.nearestEdge == "bottom" && item.end_pos.nearestEdge == "bottom")
        {
            if (Math.abs(dstBbox.maxY - srcBbox.maxY - (y2 - y1)) > dance){
                need_update = true;
                offset_y = (y2 - y1) - (dstBbox.maxY - srcBbox.maxY);
                //await eda.sys_Log.add('offset_y: ' + offset_y);
            }
        }
        if (item.start_pos.nearestEdge == "bottom" && item.end_pos.nearestEdge == "top")
        {
            if (Math.abs(dstBbox.minY - srcBbox.maxY - (y2 - y1)) > dance){
                need_update = true;
                offset_y = (y2 - y1) - (dstBbox.minY - srcBbox.maxY);
                //await eda.sys_Log.add('offset_y: ' + offset_y);
            }
        }
    }
    return {
        need_update : need_update,
        offset_x : offset_x,
        offset_y : offset_y,
    }
}

function is_coincide(pos1: any, pos2: any): boolean {
    // 快速排斥：两线段的外接矩形必须相交
    if (Math.max(pos1.startX, pos1.endX) < Math.min(pos2.startX, pos2.endX) ||
        Math.max(pos2.startX, pos2.endX) < Math.min(pos1.startX, pos1.endX) ||
        Math.max(pos1.startY, pos1.endY) < Math.min(pos2.startY, pos2.endY) ||
        Math.max(pos2.startY, pos2.endY) < Math.min(pos1.startY, pos1.endY)) {
        return false;
    }

    // 跨立实验：两线段必须互相跨立
    const cross = (a: any, b: any, c: any) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

    const A = { x: pos1.startX, y: pos1.startY };
    const B = { x: pos1.endX,   y: pos1.endY };
    const C = { x: pos2.startX, y: pos2.startY };
    const D = { x: pos2.endX,   y: pos2.endY };

    const d1 = cross(C, D, A);
    const d2 = cross(C, D, B);
    const d3 = cross(A, B, C);
    const d4 = cross(A, B, D);

    // 若异号则跨立
    return d1 * d2 <= 0 && d3 * d4 <= 0;
}

async function get_pos(pos : any)
{
    let bbox = await eda.pcb_Primitive.getPrimitivesBBox([pos.primitiveId]);
    if (bbox){
        let nearestEdge = pos.nearestEdge;
        let startX = 0, startY = 0, endX = 0, endY = 0;
        switch (nearestEdge) {
            case 'left':
                startX = bbox.minX; startY = bbox.minY;
                endX   = bbox.minX; endY   = bbox.maxY;
                break;
            case 'right':
                startX = bbox.maxX; startY = bbox.minY;
                endX   = bbox.maxX; endY   = bbox.maxY;
                break;
            case 'top':
                startX = bbox.minX; startY = bbox.minY;
                endX   = bbox.maxX; endY   = bbox.minY;
                break;
            case 'bottom':
                startX = bbox.minX; startY = bbox.maxY;
                endX   = bbox.maxX; endY   = bbox.maxY;
                break;
        }
        pos.startX = startX;
        pos.startY = startY;
        pos.endX = endX;
        pos.endY = endY;
    }
}

async function rebuild_item(item : any) {
    await get_pos(item.start_pos);
    await get_pos(item.end_pos);
    await eda.pcb_PrimitiveDimension.delete(item.dimension);
    let layer = await common.selectLayer();
    let dimension = await smart_size.create_dimension(layer, item.start_pos, item.end_pos);
    item.dimension = dimension.getState_PrimitiveId();
}

async function refresh_size_data()
{
    for (let item of smart_size.size_data){
        let dimension = await eda.pcb_PrimitiveDimension.get(item.dimension);
        if (dimension instanceof Array || !dimension){
            smart_size.size_data.splice(smart_size.size_data.indexOf(item), 1);
        }
    }
    await smart_size.save_size_data();
}

let smart_size = {
    timer : 'smart_size_timer',
    //开始标线
    start_line : null as any,
    start_pos : null as any,
    //已选择开始线
    selected_start : false,
    //结束标线
    end_line : null as any,
    end_pos : null as any,
    //已选择结束线
    selected_end : false,
    //尺寸组件
    size_component : null as any,
    //确认开始线时间
    confirm_start_time : 0,
    //尺寸数据
    size_data : [] as any,

    //回调函数
    on_add_end : null as any,
    data_sync : async function()
    {
        await common.data_sync();
    },
    load_size_data : async function()
    {
        this.size_data = await common.get_data();
        await refresh_size_data();
    },
    save_size_data : async function()
    {
        await common.save_data(JSON.stringify(this.size_data));
    },
    //清除辅助线
    clear_line : async function()
    {
        let layer = await common.selectLayer();
        let lines = await eda.pcb_PrimitivePolyline.getAll();
        for (let line of lines){
            try{
                if (line.getState_Layer() == (layer as any).id){
                    await eda.pcb_PrimitivePolyline.delete(line);
                }   
            }catch (error){
                eda.sys_Log.add('clear_line error: ' + error);
            }
        }   
        let dimension = await eda.pcb_PrimitiveDimension.getAll((layer as any).id);
        for (let dim of dimension){
            try{
                let did = dim.getState_PrimitiveId();
                let found = false;
                for (let item of this.size_data){
                    if (item.dimension == did){
                        found = true;
                        break;
                    }
                }
                if (!found){
                    await eda.pcb_PrimitiveDimension.delete(dim);
                }
            }catch (error){
                eda.sys_Log.add('clear_line error: ' + error);
            }
        }
    },
    //确认创建尺寸
    create_size : async function()
    {
        if (!this.selected_start){
            eda.sys_Message.showToastMessage("请先选择开始线");
            return;
        }
        if (!this.selected_end){
            eda.sys_Message.showToastMessage("请先选择结束线");
            return;
        }
        if (!this.start_pos || !this.end_pos){
            eda.sys_Message.showToastMessage("请先选择开始线和结束线");
            return;
        }
        if (is_coincide(this.start_pos, this.end_pos)){
            eda.sys_Message.showToastMessage("开始线和结束线不能重合");
            return;
        }
        let layer = await common.selectLayer();

        let dimension = await this.create_dimension(layer, this.start_pos, this.end_pos);        
        if (!dimension){
            eda.sys_Message.showToastMessage("创建尺寸失败");
            return;
        }
        {
            let start_data = {
                pid : this.start_pos.primitiveId,
                ne : this.start_pos.nearestEdge,
                did : dimension.getState_PrimitiveId()
            }
            let net = JSON.stringify(start_data);
            //await eda.sys_Log.add(net);
            //let polygon = (await eda.pcb_MathPolygon.createPolygon([this.start_pos.startX, this.start_pos.startY, "L", this.start_pos.endX, this.start_pos.endY])) as IPCB_Polygon;
            //let line = (await eda.pcb_PrimitivePolyline.create(net, (layer as any).id, polygon, 0.254, false)) as IPCB_PrimitivePolyline;
        }
        {
            let end_data = {
                pid : this.end_pos.primitiveId,
                ne : this.end_pos.nearestEdge,
                did : dimension.getState_PrimitiveId()
            }
            let net = JSON.stringify(end_data);
            //await eda.sys_Log.add(net);
            //let polygon = (await eda.pcb_MathPolygon.createPolygon([this.end_pos.startX, this.end_pos.startY, "L", this.end_pos.endX, this.end_pos.endY])) as IPCB_Polygon;
            //let line = (await eda.pcb_PrimitivePolyline.create(net, (layer as any).id, polygon, 0.254, false)) as IPCB_PrimitivePolyline;
        }

        let data_item = {
            start_pos : this.start_pos,
            end_pos : this.end_pos,
            dimension : dimension.getState_PrimitiveId()
        }
        this.size_data.push(data_item);
        await this.save_size_data();
        await this.load_size_data();
        //await eda.sys_Dialog.showInformationMessage(JSON.stringify(new_data), "尺寸数据");
        //await eda.sys_Log.add(JSON.stringify(this.size_data));
    },
    do_select : async function()
    {
        let prim = null as any;            
        let primitives = await eda.pcb_SelectControl.getAllSelectedPrimitives();
        if (primitives.length === 1){
            prim = primitives[0];
        }

        let pos = await get_cursor_pos();
        if (!pos)
        {
            if (prim && !(
            prim.getState_PrimitiveType() === EPCB_PrimitiveType.COMPONENT || //器件
            (prim.getState_PrimitiveType() === EPCB_PrimitiveType.REGION && (prim as any).layer == EPCB_LayerId.BOARD_OUTLINE) //板框
            ))
            {
                await eda.pcb_SelectControl.clearSelected();
                return;
            }
            /*
            if (!this.selected_start)
            {
                if (this.start_line && prim.getState_PrimitiveId() == this.start_line.getState_PrimitiveId()){
                    pos = this.start_pos;
                }               
            }else if (!this.selected_end){
                if (this.end_line && prim.getState_PrimitiveId() == this.end_line.getState_PrimitiveId()){
                    pos = this.end_pos;
                }               
            }
            */
            if (!pos)
            {
                //eda.sys_Message.showToastMessage("请先选择一条线");
                await eda.pcb_SelectControl.clearSelected();
                return;
            }
        }
        if (!this.selected_start)
        {
            eda.sys_Message.showToastMessage("确定开始线");
            this.selected_start = true;
            this.confirm_start_time = Date.now();
        }
        else
        {
            if (Date.now() - this.confirm_start_time < 1000){
                await eda.pcb_SelectControl.clearSelected();
                 return;
            }
            if (this.start_pos.primitiveId == pos.primitiveId){
                //不能选择相同图元
                await eda.pcb_SelectControl.clearSelected();
                return;
            }
            if (!this.selected_end){

                if (prim)
                { 
                    if(prim.getState_PrimitiveType() == EPCB_PrimitiveType.REGION && (prim as any).layer == EPCB_LayerId.BOARD_OUTLINE) //板框
                    {
                        await eda.sys_Message.showToastMessage("板框不能作为尺寸终止元件");
                        await eda.pcb_SelectControl.clearSelected();
                        return;
                    }
                }
                //闭环检测
                if (circle_check(this.start_pos.primitiveId, pos.primitiveId, pos.nearestEdge)){
                    await eda.sys_Message.showToastMessage("尺寸线不能形成闭环");
                    await eda.pcb_SelectControl.clearSelected();
                    return;
                }

                eda.sys_Message.showToastMessage("确定结束线");

                // 计算并显示 start_pos 与 end_pos 之间的垂直或水平距离
                let distance = 0;
                if (smart_size.start_pos.nearestEdge === 'left' || smart_size.start_pos.nearestEdge === 'right') {
                    // 垂直距离
                    distance = Math.abs(smart_size.end_pos.startX - smart_size.start_pos.startX);
                } else {
                    // 水平距离
                    distance = Math.abs(smart_size.end_pos.startY - smart_size.start_pos.startY);
                }
                //mil转mm
                distance = await eda.sys_Unit.milToMm(distance, 4);
                await eda.sys_Dialog.showInputDialog("请输入尺寸值", "两个图元的距离，单位：mm", "确认距离", "number", distance,
                    {
                        /*
        max?: number;
        maxlength?: number;
        min?: number;
        minlength?: number;
        multiple?: boolean;
        pattern?: RegExp;
        placeholder?: string;
        readonly?: boolean;
        step?: number;
        */
                    }, async (value)=>{
                        try{
                            if (value){
                                if (value != distance){
                                    let diff = distance - value;
                                    let milVal = await eda.sys_Unit.mmToMil(diff, 4);
                                    if (smart_size.end_pos.nearestEdge == 'left'){
                                        if (smart_size.end_pos.startX > smart_size.start_pos.startX){
                                            milVal = -milVal;
                                        }
                                        smart_size.end_pos.startX = smart_size.end_pos.startX + milVal;   
                                        smart_size.end_pos.endX = smart_size.end_pos.startX;
                                    }else if (smart_size.end_pos.nearestEdge == 'top'){
                                        if (smart_size.end_pos.startY > smart_size.start_pos.startY){
                                            milVal = -milVal;
                                        }
                                        smart_size.end_pos.startY = smart_size.end_pos.startY + milVal;      
                                        smart_size.end_pos.endY = smart_size.end_pos.startY;
                                    }else if (smart_size.end_pos.nearestEdge == 'right'){
                                        if (smart_size.end_pos.endX > smart_size.start_pos.endX){
                                            milVal = -milVal;
                                        }
                                        smart_size.end_pos.endX = smart_size.end_pos.endX + milVal;   
                                        smart_size.end_pos.startX = smart_size.end_pos.endX;
                                    }else if (smart_size.end_pos.nearestEdge == 'bottom'){
                                        if (smart_size.end_pos.endY > smart_size.start_pos.endY){
                                            milVal = -milVal;
                                        }
                                        smart_size.end_pos.endY = smart_size.end_pos.endY + milVal;   
                                        smart_size.end_pos.startY = smart_size.end_pos.endY;
                                    }
                                }
                                await smart_size.create_size();
                                await smart_size.apply_size_data();
                            }
                        }catch (e){
                            await eda.sys_Log.add(`create_size error: ${e}`);
                        }
                        
                        await smart_size.add_end();
                        if (smart_size.on_add_end){
                            await smart_size.on_add_end();
                        }
                        await eda.sys_Timer.setTimeoutTimer("add_end", 1000, async ()=>{
                            await smart_size.add_end();
                        });
                    }
                );

                this.selected_end = true;
            }
        }
        await eda.pcb_SelectControl.clearSelected();
    },
    create_dimension : async function(layer : any, start_pos : any, end_pos : any)
    {
        let startx1 = 0;
        let starty1 = 0;
        let endx1 = 0;
        let endy1 = 0;
        let startx2 = 0;
        let starty2 = 0;
        let endx2 = 0;
        let endy2 = 0;
        let linetype = 0;
        if (!start_pos)
        {
            start_pos = smart_size.start_pos;
        }
        if (!end_pos)
        {
            end_pos = smart_size.end_pos;
        }
        if (start_pos.endX === start_pos.startX){
            //垂直线
            linetype = 1;
            startx1 = start_pos.startX;
            starty1 = (end_pos.endY + end_pos.startY) / 2;
            endx1 = end_pos.startX;
            endy1 = starty1;
            startx2 = startx1;
            endx2 = endx1;
            starty2 = endy2 = Math.max(starty1, endy1) + 200;
        }else if (start_pos.endY === start_pos.startY){
            //水平线
            linetype = 2;
            startx1 = (end_pos.endX + end_pos.startX) / 2;
            starty1 = start_pos.startY;
            endx1 = startx1
            endy1 = end_pos.endY;
            starty2 = starty1;
            endy2 = endy1;
            startx2 = endx2 = Math.max(startx1, endx1) + 200;
        }
        else{
            await eda.sys_Message.showToastMessage("错误的终止线");
        }
        let lineWidth = await eda.sys_Unit.mmToMil(1);
        let dimension = (await eda.pcb_PrimitiveDimension.create(EPCB_PrimitiveDimensionType.LENGTH, 
                [startx1, starty1, startx2, starty2, endx2, endy2, endx1, endy1], (layer as any).id, ESYS_Unit.MILLIMETER, 8, 4, false)) as IPCB_PrimitiveDimension;
        (dimension as any).textFollow = 1;        
        return dimension;
    },
    add_start : async function()
    {
        this.selected_start = false;
        this.selected_end = false;
        this.start_pos = null;
        this.end_pos = null;
        let layer = await common.selectLayer();
        await eda.pcb_Event.addMouseEventListener("smart_size_mouse_event", 'all', async function(eventType: any)
        {
            if (eventType === 'selected'){
                await smart_size.do_select();    
            }
        }, false);

        await eda.sys_Timer.setIntervalTimer(this.timer, 100, async function()
        {
            const cursor = await eda.pcb_SelectControl.getCurrentMousePosition();
            let prim = null;
            if (cursor) {
                prim = await eda.pcb_Document.getPrimitiveAtPoint(cursor.x, cursor.y);
            }

            let pos = await get_cursor_pos();
            if (!pos){
                return;
            }
            let startX = pos.startX;
            let startY = pos.startY;
            let endX = pos.endX;
            let endY = pos.endY;
            let polygon = (await eda.pcb_MathPolygon.createPolygon([startX, startY, "L", endX, endY])) as IPCB_Polygon;

            if (!smart_size.selected_start){
                smart_size.start_pos = pos;
                let line = (await eda.pcb_PrimitivePolyline.create("", (layer as any).id, polygon, 8, false)) as IPCB_PrimitivePolyline;
                if (smart_size.start_line){
                    await eda.pcb_PrimitivePolyline.delete(smart_size.start_line);
                    smart_size.start_line = null;
                }
                smart_size.start_line = line;
            }else if (!smart_size.selected_end && !is_coincide(smart_size.start_pos, pos) && is_true_pos(smart_size.start_pos, pos)
                && smart_size.start_pos.primitiveId != pos.primitiveId
            ){
                //检测是否是板框
                if (prim)
                { 
                    //await eda.sys_Log.add('prim type: ' + prim.getState_PrimitiveType());
                    //await eda.sys_Log.add('prim layer: ' + (prim as any).layer);
                    if(prim.getState_PrimitiveType() == EPCB_PrimitiveType.REGION && (prim as any).layer == EPCB_LayerId.BOARD_OUTLINE) //板框
                    {
                        //await eda.sys_Message.showToastMessage("板框不能作为尺寸终止元件");
                        return;
                    }
                }

                smart_size.end_pos = pos;
                let line = (await eda.pcb_PrimitivePolyline.create("", (layer as any).id, polygon, 8, false)) as IPCB_PrimitivePolyline ;
                if (smart_size.end_line){
                    await eda.pcb_PrimitivePolyline.delete(smart_size.end_line);
                    smart_size.end_line = null;
                }
                smart_size.end_line = line;
                let dimension = await smart_size.create_dimension(layer, smart_size.start_pos, smart_size.end_pos);        
                if (smart_size.size_component){
                    await eda.pcb_PrimitiveDimension.delete(smart_size.size_component);
                    smart_size.size_component = null;
                }
                smart_size.size_component = dimension;
            }
        });
        
    },
    add_end : async function()
    {
        try{
            await eda.pcb_Event.removeEventListener("smart_size_mouse_event");
            await eda.sys_Timer.clearIntervalTimer(this.timer);
        }catch (error){
            eda.sys_Log.add('add_end error: ' + error);
        }
        this.selected_start = false;
        this.selected_end = false;
        if (this.start_line){
            try{
                await eda.pcb_PrimitivePolyline.delete(this.start_line);
                this.start_line = null;
            }catch (error){
                eda.sys_Log.add('add_end error: ' + error);
            }
        }
        if (this.end_line){
            try{
                await eda.pcb_PrimitivePolyline.delete(this.end_line);
                this.end_line = null;
            }catch (error){
                eda.sys_Log.add('add_end error: ' + error);
            }
        }
        if (this.size_component){
            try{
                await eda.pcb_PrimitiveDimension.delete(this.size_component);
                this.size_component = null;
            }catch (error){
                eda.sys_Log.add('add_end error: ' + error);
            }   
        }
    },
    clear_size_data : async function()
    {
        for (let item of this.size_data){
            await eda.pcb_PrimitiveDimension.delete(item.dimension);
            await eda.pcb_PrimitiveDimension.delete(item.dimension);
        }
        this.size_data = [];
        this.save_size_data();
    },
    is_visible : async function()
    {
        try{
            let layer = await common.selectLayer();
            if (layer){
                return layer.layerStatus != 2;
            }
            return false;
        }catch (error){
            eda.sys_Log.add('is_visible error: ' + error);
            return false;
        }
    },
    show_smart_size : async function()
    {
        let layer = await common.selectLayer();
        if (layer){
            await eda.pcb_Layer.setLayerVisible((layer as any).id);
        }
    },
    hide_smart_size : async function()
    {
        let layer = await common.selectLayer();
        if (layer){
            await eda.pcb_Layer.setLayerInvisible((layer as any).id);
        }
    },
    apply_size_data : async function()
    {
        let has_update = false;
        let times = 0;
        do{
            has_update = false;
            for (let item of this.size_data)
            {
                try{
                    let calc_result = await calc_offset(item);
                    if (calc_result.need_update){
                        let dstPrimitive = null;

                        if (item.end_pos.primitiveType == EPCB_PrimitiveType.COMPONENT){
                            dstPrimitive = await eda.pcb_PrimitiveComponent.get(item.end_pos.primitiveId);
                        }else if (item.end_pos.primitiveType == EPCB_PrimitiveType.IMAGE){
                            dstPrimitive = await eda.pcb_PrimitiveImage.get(item.end_pos.primitiveId);
                        }else if (item.end_pos.primitiveType == EPCB_PrimitiveType.PAD){
                            dstPrimitive = await eda.pcb_PrimitivePad.get(item.end_pos.primitiveId);
                        }else if (item.end_pos.primitiveType == EPCB_PrimitiveType.VIA){
                            dstPrimitive = await eda.pcb_PrimitiveVia.get(item.end_pos.primitiveId);
                        }
                        /*else if (item.end_pos.primitiveType == EPCB_PrimitiveType.STRING){
                            dstPrimitive = await eda.pcb_PrimitiveString.get(item.end_pos.primitiveId);
                        }else if (item.end_pos.primitiveType == EPCB_PrimitiveType.REGION){
                            dstPrimitive = await eda.pcb_PrimitiveRegion.get(item.end_pos.primitiveId);
                        }
                        */
                        if (!dstPrimitive){
                            continue;
                        }
                        has_update = true;
                        let x = dstPrimitive.getState_X();
                        let y = dstPrimitive.getState_Y();
                        dstPrimitive.setState_X(x + calc_result.offset_x);
                        dstPrimitive.setState_Y(y + calc_result.offset_y);
                        if (item.end_pos.primitiveType == EPCB_PrimitiveType.COMPONENT){
                            await eda.pcb_PrimitiveComponent.modify(dstPrimitive.getState_PrimitiveId(),{
                                x : x + calc_result.offset_x,
                                y : y + calc_result.offset_y
                            });
                        }else if (item.end_pos.primitiveType == EPCB_PrimitiveType.IMAGE){
                            await eda.pcb_PrimitiveImage.modify(dstPrimitive.getState_PrimitiveId(),{
                                x : x + calc_result.offset_x,
                                y : y + calc_result.offset_y
                            });
                        }else if (item.end_pos.primitiveType == EPCB_PrimitiveType.PAD){
                            await eda.pcb_PrimitivePad.modify(dstPrimitive.getState_PrimitiveId(),{
                                x : x + calc_result.offset_x,
                                y : y + calc_result.offset_y
                            });
                        }else if (item.end_pos.primitiveType == EPCB_PrimitiveType.VIA){
                            await eda.pcb_PrimitiveVia.modify(dstPrimitive.getState_PrimitiveId(),{
                                x : x + calc_result.offset_x,
                                y : y + calc_result.offset_y,
                                holeDiameter : (dstPrimitive as IPCB_PrimitiveVia).getState_HoleDiameter()
                            });
                        }
                    }
                }catch (error){
                    has_update = false;
                    eda.sys_Log.add('apply_size_data error: ' + error);
                 }                
            }
            times++;
        }while(has_update && times < 50);
        await refresh_size_data();
        await this.rebuild();
    },
    rebuild : async function()
    {
        for (let item of this.size_data){
            await rebuild_item(item);
        }
        await refresh_size_data();
    },
};



export default smart_size;
