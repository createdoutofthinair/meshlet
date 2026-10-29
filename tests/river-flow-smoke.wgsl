@group(1) @binding(0) var<storage,read_write> flowProbe:array<vec4<f32>>;
@compute @workgroup_size(1) fn probeRiverFlow(){
 let bend=.8;
 flowProbe[0]=vec4<f32>(riverDepthAtBend(-.5,bend),riverDepthAtBend(.5,bend),riverFlowSpeedAtBend(-.5,bend),riverFlowSpeedAtBend(.5,bend));
 flowProbe[1]=vec4<f32>(riverFlowCoordinate(10.0,0.0,1.0),riverFlowCoordinate(11.0,1.0,1.0),riverFlowSpeedAtBend(0.0,0.0),riverFlowSpeedAtBend(.98,0.0));
 flowProbe[2]=vec4<f32>(riverAdvectedSlopes(0.0,0.0,0.0,1.0,1.0),riverAdvectedSlopes(0.0,0.0,1.0,1.0,1.0));
 flowProbe[3]=vec4<f32>(riverAdvectedStreak(0.0,0.0,0.0,1.0),riverAdvectedStreak(0.0,0.0,1.0,1.0),riverAdvectedStreak(0.0,0.0,31.999,1.0),riverAdvectedStreak(0.0,0.0,32.001,1.0));
 flowProbe[4]=vec4<f32>(riverAdvectedSlopes(0.0,0.0,31.999,1.0,1.0),riverAdvectedSlopes(0.0,0.0,32.001,1.0,1.0));
 flowProbe[5]=vec4<f32>(waterFresnel(1.0),waterFresnel(.25),waterFresnel(0.0),riverBubblePattern(vec2<f32>(.37,.71)));
 flowProbe[6]=vec4<f32>(waterTransmittance(0.0,1.0).x,waterTransmittance(2.0,1.0).x,waterTransmittance(8.0,1.0).x,waterTransmittance(8.0,1.0).z);
 flowProbe[7]=vec4<f32>(riverMacroWave(0.0,0.0,0.0,1.0),riverMacroWave(0.0,0.0,1.0,1.0),riverMacroWave(0.0,0.0,31.999,1.0),riverMacroWave(0.0,0.0,32.001,1.0));
}
