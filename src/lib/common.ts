import * as extensionConfig from '../../extension.json';

export function test()
{
    eda.sys_Dialog.showInformationMessage(
        eda.sys_I18n.text('test', undefined, undefined, extensionConfig.version),
        eda.sys_I18n.text('About'),
    );
}


export async function selectLayer()
{
    let _layer = null;
    let layers = await eda.pcb_Layer.getAllLayers();
    for (const layer of layers) {
        if (layer.name === '智能尺寸') {
            // 找到目标层后可在此继续处理
            _layer = layer as any;
            break;
        }
    }
    if (!_layer) {
        let layer_id = await eda.pcb_Layer.addCustomLayer();
        if (layer_id) {
            await eda.pcb_Layer.modifyLayer(layer_id, {
                name: '智能尺寸',
                color: '#FFFFFF'
            });
        }
        let layers = await eda.pcb_Layer.getAllLayers();
        for (const layer of layers) {
            if (layer.name === '智能尺寸') {
                // 找到目标层后可在此继续处理
                _layer = layer as any;
                break;
            }
        }
    }
    if (_layer) {
        await eda.pcb_Layer.selectLayer((_layer as any).id);
    }
    return _layer;
}

export async function save_data(data : string)
{
    let layer = await selectLayer();
    //eda.pcb_PrimitiveString.create(layer, x, y, text, fontFamily, fontSize, lineWidth, alignMode, rotation, reverse, expansion, mirror, lock);
    //eda.pcb_PrimitiveString.create(1, 0, 0, "测试", "default", 120, 7, 3, 0, false, 0, false, false);
    /*
    let primitives = await eda.pcb_PrimitiveObject.getAll(layer, true);
    for (let primitive of primitives) {
        if (primitive.getState_FileName() === 'smart-size') {
            await primitive.setState_BinaryData(data);
            return primitive;
        }
    }
    let primitive = await eda.pcb_PrimitiveObject.create(layer, 0, 0, data, 0.1, 0.1, 0, false, "smart-size", true);
    */
    let primitives = await eda.pcb_PrimitiveString.getAll((layer as any).id, true);
    for (let primitive of primitives) {
        if (primitive.getState_FontFamily() === 'smart-size-data') {
            //setState_Text 没有效果，只能通过重新创建来设置文本
            //await eda.sys_Log.add(`primitive id: ${primitive.id}, data: ${data}`);
            //await primitive.setState_Text(data);
            //return primitive;
            await eda.pcb_PrimitiveString.delete(primitive);
        }
    }
    //await eda.sys_Log.add(`layer id: ${(layer as any).id}, data: ${data}`);
    let primitive = await eda.pcb_PrimitiveString.create((layer as any).id, 0, 0, data, "smart-size-data", 0.001, 0.001, 3, 0, false, 0, false, true);
    return primitive;
}

export async function get_data()
{
    let layer = await selectLayer();
    /*
    let primitives = await eda.pcb_PrimitiveObject.getAll(layer, true);
    for (const primitive of primitives) {
        if (primitive.getState_FileName() === 'smart-size') {
            return primitive.getState_BinaryData();
        }
    }
    */
    let primitives = await eda.pcb_PrimitiveString.getAll((layer as any).id, true);
    for (let primitive of primitives) {
        if (primitive.getState_FontFamily() === 'smart-size-data') {
            let data = await primitive.getState_Text();
            //await eda.sys_Log.add(`data type: ${typeof data}, data: ${data}`);
            if (typeof data === 'object') {
                return data;
            }
            if (typeof data === 'string') {
                return JSON.parse(data);    
            }
        }
    }
    return [];
}

//本地数据和板上数据互相同步
export async function data_sync()
{
    let data = await get_data();
    let board = await eda.dmt_Pcb.getCurrentPcbInfo();
    if (!board) {
        return;
    }
    let boardid = board.uuid;
    //await eda.sys_Log.add(`board id: ${boardid}`);
    if (data.length > 0) {
        await eda.sys_Storage.setExtensionUserConfig('smart-size-data_'+boardid, JSON.stringify(data));
    }else{
        data = await eda.sys_Storage.getExtensionUserConfig('smart-size-data_'+boardid);    
        if (data) {
            await save_data(data);
        }
    }
}
